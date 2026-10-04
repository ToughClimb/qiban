# Windows desktop preview

The desktop build runs the same Chinese conversation screen in Electron. API requests run in the main process; the renderer has no network or Node access. First launch offers a visibly labeled offline demo or a public HTTPS OpenAI-compatible API address and key. DeepSeek uses its documented default model; other services with more than one model ask for a selection. A successful model-list check verifies credentials and compatibility, not paid chat quality. There are no automatic chat retries.

Run from source with Node 24:

```sh
npm ci
npm run desktop:start
```

Build on Windows x64:

```sh
npm run desktop:make
```

The Squirrel installer and ZIP appear below `out/make/`. Installer signing is not configured; Windows may warn about an unknown publisher. No updater or release feed is configured. Feature CI does not upload installers; the separately gated preview workflow is described in `RELEASING.md`. The disposable Windows CI runner checks installation, upgrade preservation and removal of known Qiban stores. Standard-user installation and Chinese IME still need manual Windows acceptance. Full bundled dependency license texts are included in `resources/THIRD_PARTY_NOTICES.txt`; Electron and Chromium notices remain in the application directory.

## Local data

The stable Windows directory is `%APPDATA%\Qiban`. `history.json` is versioned readable JSON containing separate conversations. Reset affects only the selected character. Up to 200 messages per character are retained. `connection.json` contains the API address/model and an encrypted key only when “记住密钥” is explicitly selected. Without that checkbox, the key lasts until the app closes. Windows uses Electron safeStorage/DPAPI; no plaintext fallback is allowed. This protects against other Windows users, not software already running as the same user.

Back up `history.json`, `cards`, `avatars` and `chat-images` while the app is closed. Avatar files are local resized PNGs keyed by the same stable character IDs; they are not sent to the model. Chat images are separate normalized PNG files referenced by history. Do not share connection settings or key material. Settings offers a separate key deletion and confirmed deletion of all local data. The uninstall handler removes known Qiban conversations, role files/backups, avatars, chat images and saved connection settings. Electron may recreate Chromium files as the uninstall process exits. Those residual files have not been audited and may contain private metadata; the test does not establish that all private data is removed. Replacing the application should retain the user-data directory.

## Chat images

The attachment button opens the local file picker. PNG, JPEG and static WebP sources are limited to 5 MiB and a 4096-pixel edge. Images are decoded locally, stripped of metadata and normalized to PNG with at most a 1600-pixel edge and 1 MiB. Selection and preview make no provider request. Only explicit Send submits image bytes; text is optional. Demo mode and unsupported models fail visibly without pretending to inspect an image.

Live image chat requires a configured DeepSeek-compatible `deepseek-flash` connection. At most three recent images and 3 MiB are included in one model request. Older omitted images remain in local history and display an omission notice. Failed image turns can be retried or edited; a missing pending image can be removed or replaced without clearing earlier text. Reset, role deletion and delete-all remove their owned files. Missing or corrupt referenced files fail closed; reset the affected conversation if an unavailable historical image blocks later replies. See `../desktop/IMAGE_CHAT.md` for the native bridge and lifecycle details.

## Connection limits

HTTPS public endpoints only. Local/private/reserved DNS answers, embedded credentials, query strings, and redirects are rejected. A changed provider requires a freshly entered key. Native requests resolve and pin the target address, verify TLS, limit response size, and time out after 10 seconds for setup or 25 seconds for chat. This version reads standard HTTP(S) proxy environment variables rather than Windows proxy settings. A configured proxy is required for egress and never silently bypassed; destination TLS verification remains enabled. JSON model lists and non-streaming chat completions are supported; incompatible services produce a readable error. No key, reasoning field, or provider error body is returned to the renderer.

`npm test` covers storage failures, host changes, DNS restrictions, cancellation, history, and real local HTTPS redirect handling using synthetic credentials. `npm run test:desktop` runs Electron onboarding/chat/restart and renderer security checks; on Linux it needs a display and uses the test runner's no-sandbox launch flag. Production windows retain sandbox, context isolation and web security. Passing on Linux is not Windows installer acceptance.

Local V1/V2 JSON character import, preview, original-source export, creation, editing and backups are available under 管理角色. See `CHARACTER_CARDS.md` for supported fields, limits and closed-app maintenance.

## Installer lifecycle CI

`tests/installer-smoke.mjs` is restricted to the disposable Windows CI runner. It refuses existing installations or user data, runs the real Squirrel installer in documented silent mode, sends one offline synthetic message, seeds an original synthetic card and DPAPI-encrypted synthetic key, then verifies relaunch. It generates a higher NuGet package version from the unchanged application payload to check an actual installer upgrade and exact preservation of user-file bytes, then runs the installed updater’s uninstaller and checks removal of both installed executables and all conversation/role/key files. A recreated directory is reported separately; its residual Chromium contents are not audited for private metadata. The upgrade package is ephemeral and is not uploaded.

This uses the hosted runner’s existing administrator account; UAC is disabled by the runner image. It does not create accounts, change security settings, purchase signing or bypass warnings. Passing this test establishes per-user paths and lifecycle behavior under that runner account. It does not establish ordinary-user installation, manual SmartScreen acceptance, Chinese IME behavior or upgrade behavior across future schema changes.

`tests/native-provider-reachability.ts` makes one unpaid request to DeepSeek’s model-list endpoint using the production native HTTPS transport and an explicitly synthetic key. It exercises public DNS validation, TLS and JSON/auth-error handling. It does not call inference, establish valid-key authentication, or prove live reply quality. This is separate from web-adapter model checks; credential-backed native inference remains unverified. The current cloud task blocks direct DNS, so that probe runs on standard Windows CI instead.

For a credential-backed native text check, use `tests/native-live-smoke.ts` only after approving its one bounded paid request. Inject the credential through the existing environment's secure launch configuration under `DEEPSEEK_API_KEY` or `deepseek`, then set `QIBAN_ALLOW_ONE_NATIVE_LIVE_CHECK=1` and run `node --import tsx tests/native-live-smoke.ts`. It calls the exact production `requestJson` transport once at the fixed DeepSeek endpoint, limits output to 32 tokens, uses only a synthetic prompt, and logs status/token counts rather than key or reply contents. There are no retries. It needs public DNS and direct HTTPS or a supported configured HTTP(S) proxy. Do not move a network-secret placeholder into another environment, extract a real secret, add CI credentials, disable TLS/DNS checks, or put a key in chat to run it. This check has not been run in this checkout's environment; image unit tests use injected synthetic transports and do not establish credential-backed native vision inference.
