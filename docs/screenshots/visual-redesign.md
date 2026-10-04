# Qiban visual review

Branch: `feat/visual-redesign`. Verified starting head: `0eb6dcc0509445d5d0ed8420ca80588711517b4b` on `feat/qiban-mvp`.

## Direction

A quiet conversational space with a narrow companion rail, paper and ink contrast, local serif display typography, larger oval portraits, unboxed assistant messages, restrained navigation and a compact composer. The welcome portrait yields to the conversation after the first message. Existing original character art is reused; the small botanical footer is an original inline SVG. There are no new dependencies, remote fonts, analytics or paid image calls.

Application state, message handling, connection handlers, provider behavior, character-card schemas and native code are unchanged. Virtual-character identity remains in the chat header; demo disclosure remains above the conversation, and individual reply provenance remains in saved message labels.

## Rendered evidence

These are actual Chromium captures of the production renderer at **1280×800** and **390×844**. A synthetic in-memory desktop bridge exposes the existing desktop settings and character controls; all data and replies are synthetic. They demonstrate renderer presentation, not native Windows installation or Android-device acceptance. The welcome captures show the fresh conversation canvas after dismissing setup; settings captures show the same setup modal used on first launch.

| View | Before | After |
| --- | --- | --- |
| Desktop welcome | [Before](visual-before-desktop-firstlaunch.png) | [After](visual-after-desktop-firstlaunch.png) |
| Desktop chat | [Before](visual-before-desktop-chat.png) | [After](visual-after-desktop-chat.png) |
| Desktop settings | [Before](visual-before-desktop-settings.png) | [After](visual-after-desktop-settings.png) |
| Mobile welcome | [Before](visual-before-mobile-firstlaunch.png) | [After](visual-after-mobile-firstlaunch.png) |
| Mobile chat | [Before](visual-before-mobile-chat.png) | [After](visual-after-mobile-chat.png) |
| Mobile settings | [Before](visual-before-mobile-settings.png) | [After](visual-after-mobile-settings.png) |

Additional actual card-preview captures: [desktop](visual-after-desktop-card-preview.png), [mobile](visual-after-mobile-card-preview.png).

## Verification

- `npm run typecheck`, `npm test` (32 tests), `npm run build`, `npm run desktop:build` pass.
- `npm run test:ui` passes existing chat isolation, persistence, reset, retry/edit, cancellation, storage failure, invite and demo/live provenance checks.
- `node tests/connection-panel-smoke.mjs` passes all eight synthetic connection/model-selection scenarios with no external requests or page errors.
- Additional Chromium checks pass at both review sizes: visible composer, no document horizontal overflow, keyboard dialog focus containment and Escape dismissal, character creation/preview/acknowledgement/save/edit, Enter send, and Shift+Enter newline. These renderer checks do not assert native file operations.
- Both review sizes have zero browser runtime errors. Contrast for body text, captions, controls and focus indicators is retained. Reduced-motion and mobile safe-area rules are preserved.

## Parent follow-up

Native Electron smoke tests could not run in this environment: the Electron binary download fails and no display server is installed. The renderer build passes; Windows and Android acceptance remain with their platform owners.

An existing focus issue was reproduced on both the untouched base and this branch: after keyboard send, `App.tsx` calls `input.focus()` before React removes the disabled state, leaving focus on the document body. This branch does not change that stateful logic. The app owner should defer focus until the composer is enabled.

The existing first-launch form receives refined styling. A demo-first onboarding composition would require coordinated presentation ownership of `ConnectionPanel.tsx`; its handlers and state remain outside this branch's current scope. This is a draft for parent visual acceptance, with no merge, integration or release implied.
