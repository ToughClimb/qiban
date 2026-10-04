# Image chat UI review

Branch: `feat/image-chat-ui`. Integration at branch start: `8c9d14c33fffb85598b08d9ac2087c2bd8b1f567`.

Dependencies applied separately: approved theme `18b0ec7` / `0e4a362` as `d69fe63` / `f1a4c4e`, then approved image core `8a7107229142367ff7e3a1b4d85aeb6f42428068` as `019f013068476cc001c2ed9df7d04a99941d7e38`. Only commits after `019f013` are the UI delivery. No source changes to shared types, native implementations, manifests or `src/api.ts` are included in those commits.

The existing composer gains a paperclip action and one removable draft thumbnail. Send accepts text or one image. Picking stages locally and never invokes chat. New draft files are discarded on remove, switch, reset and late-picker cancellation; committed history images are retained. Editing an unanswered image turn keeps its persisted reference until Send replaces the turn, so switching away or storage cleanup cannot silently destroy the attachment.

History previews use `chatImagePreview(characterId, imageId)`, never a URL stored in history. The UI accepts bounded PNG/JPEG/WebP data previews from the typed local bridge and rejects remote/file/SVG URLs. Missing or failed previews have a visible fallback. Native preview implementations should return raster data URLs. Reply omissions are shown beside the corresponding historical thumbnail; stored attachment metadata is unchanged. Existing focus restoration, keyboard/IME handlers and accent preferences are preserved.

## Actual rendered evidence

Production Chromium renderer with a synthetic native bridge, at 1280×800 and 390×844. The landscape PNG was generated locally for this test; every message and identifier is synthetic. No user images, private content, provider keys or live calls are involved. These demonstrate renderer presentation, not native image storage or provider acceptance. All six screenshots are retained in Library.

| View | Desktop | Mobile |
| --- | --- | --- |
| Selected image draft | [Desktop](image-chat-desktop-draft.png) | [Mobile](image-chat-mobile-draft.png) |
| Image in conversation | [Desktop](image-chat-desktop-history.png) | [Mobile](image-chat-mobile-history.png) |
| Model error / omitted image | [Unsupported model](image-chat-desktop-unsupported-model.png) | [Omitted historical image](image-chat-mobile-omitted-image.png) |

## Checks and integration blocker

- Typecheck, 52 unit tests, web build and desktop renderer build pass.
- Existing chat, six composer-focus/IME scenarios, ten connection/onboarding scenarios, seven avatar scenarios, and theme persistence/wipe smoke pass.
- `node tests/image-chat-ui-smoke.mjs` runs 13 production-renderer scenarios. Ten pass. Three retain deliberately failing outgoing-attachment/context assertions because the unchanged core renderer adapter currently strips `image` from every message. Their UI-side checks exercise image-only focus/reload, retry/edit and stored-image preservation before the failing transport assertions.
- Passing scenarios cover local selection without chat, one-image limits, keyboard removal, picker cancellation/errors, unsupported platforms, staged/late picker cleanup, reset, safe historical fallbacks, reply omission display, committed-image editing, and desktop/mobile layout with a saved accent. Captures have no horizontal overflow, external image requests or browser runtime errors.

**Core owner handoff:** `src/api.ts` must preserve `image` in the outgoing messages, use `prepareChatContext`, and combine its `omittedImageIds` with the bridge/server reply omissions. Its public `ChatReply` must expose the optional omission IDs. Until that separate adapter fix is integrated, this is a reviewable UI candidate, not complete image-send acceptance. The UI smoke should then pass all 13 scenarios without changing its payload assertions.

Native image picker/storage, cancellation, file cleanup, and Windows/Android acceptance remain with their platform owners. No paid API calls were made.
