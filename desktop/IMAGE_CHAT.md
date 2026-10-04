# Native chat-image integration

Based on integration commit `fa851df3d2acb07f4e8ad46c462f5baa649664bb` and the existing shared image types/serializer. This change owns only desktop code and focused native tests; composer/UI and Android integration are separate.

## Renderer contract

The optional `DesktopBridge` methods already defined in `shared/desktop.ts` are exposed by the frozen preload bridge:

- `pickChatImage(characterId)` opens a single native file picker and returns `Result<ChatImageDraft | null>`. No provider request occurs. A new selection invalidates pending pickers/decoders and discards earlier uncommitted selections. Cancelling returns null.
- `chatImagePreview(characterId, imageId)` returns `Result<string | null>`. Previews are bounded `data:image/png;base64,...` URLs containing only validated, normalized raster bytes (at most 1 MiB decoded). They match the UI raster data-URL allowlist and never expose filesystem paths. An unavailable, deleted or wrong-owner image returns null. Malformed IDs fail validation.
- `discardChatImage(characterId, imageId)` removes an uncommitted draft. References in saved history remain protected until history is reset/replaced. Discarding an older ID cannot cancel a newer selection.

The UI must discard the selected draft on removal, character switch or reset. If a picker returns after the UI has switched/reset, discard that stale returned ID immediately. A picker has no ID until it returns, so this late-result guard belongs in the UI. Native generation checks additionally prevent resurrection after selection replacement, history reset, card deletion or clear-all. Do not cache preview URLs in history.

Persist `{ id, role: "user", content: "", image: ChatImageAttachment }` for image-only messages through `saveHistory`; empty text is supported by the integrated shared schema. The first explicit Send can resolve a staged draft before the history save effect runs. Unrelated history saves retain staged drafts. Save the user turn before discarding a successfully submitted selection. History stores the five-field attachment reference only; normalized bytes live separately in `%APPDATA%\Qiban\chat-images\<characterId>\image-<UUID>.png`.

Only explicit `chat(request, requestId)` submits images to the configured native provider. Use the existing shared context preparation and display returned `omittedImageIds`. Native serialization independently limits context to three recent images and 3 MiB and reports omissions without rewriting history. The existing core permits images for `deepseek-flash` on a DeepSeek-compatible configured connection; demo and unsupported models fail before any completion request. No capability probe or automatic image request is added.

## Storage and lifecycle

The main process accepts source paths only from the native picker. Header preflight rejects active/animated formats, files over 5 MiB and dimensions over 4096. A sandboxed temporary Chromium document decodes PNG/JPEG/static WebP, rejects invalid decodes, and redraws to PNG at a maximum edge of 1600. Dense images are progressively downsampled until at most 1 MiB. Ancillary metadata is stripped and the existing trusted serializer validates the output. The decoder has no preload, Node access, persistent session, external image sources or network permission; its window is destroyed afterward.

Sources and stored files must be regular, non-symlink files. Store and character directories cannot be symlinks. Character IDs and image UUIDs are validated before constructing paths; the resolver checks character ownership and exact attachment metadata before encoding bytes.

Successful history saves prune images removed from that history while retaining unchanged characters and live drafts. A shrinking/reset conversation cancels that character's in-flight request and invalidates its pending selection. Card deletion removes only that character's image directory. All-data deletion clears images and invalidates pending operations. Normal exit drops drafts, and startup prunes unreferenced drafts left by crashes. Damaged history remains recoverable: startup retains files rather than pruning without a validated snapshot. Existing Squirrel uninstall deletes the entire Qiban user-data directory, including chat images.

## Verification

Commands (no paid requests; provider tests use synthetic keys and injected transports):

```sh
node --import tsx --test tests/native-chat-images.test.ts tests/avatars.test.ts tests/desktop.test.ts tests/image-chat.test.ts
npm run typecheck
npm test
npm run build
npm run desktop:build
XDG_CACHE_HOME=/tmp/qiban-cache npm run desktop:package
DISPLAY=:99 npm run test:desktop
DISPLAY=:99 node tests/native-chat-images-smoke.mjs
XDG_CACHE_HOME=/tmp/qiban-cache node_modules/.bin/electron-forge package --platform=linux --arch=x64
DISPLAY=:99 QIBAN_PACKAGED_EXE="$PWD/out/Qiban-linux-x64/Qiban" node tests/native-chat-images-smoke.mjs
```

The image smoke invokes the actual packaged preload/IPC/Chromium decoder. It covers PNG/JPEG/WebP, 1600-edge resizing, noisy-image downsampling below 1 MiB, preview rendering, selection/discard/cancel, owner isolation, image-only history/restart, scoped reset/card deletion, out-of-order dialogs, and late-dialog clear-all. Existing desktop smoke checks avatar regressions, sandbox/CSP, renderer Node isolation and untrusted-window IPC denial.

All 62 tests and the build/typecheck checks passed. The Windows x64 cross-package build also passed. Linux packaged smoke establishes the Electron implementation path, not Windows installation, DPAPI or Squirrel uninstall acceptance. Windows validation and the composer integration remain with the parent/platform workers. No real provider images or configured secrets were accessed during implementation.
