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

The Squirrel installer and ZIP appear below `out/make/`. Installer signing is not configured; Windows may warn about an unknown publisher. No updater or release feed is configured. Installers are not published by CI. The disposable Windows CI runner checks installation, upgrade preservation and removal of known Qiban stores. Standard-user installation and Chinese IME still need manual Windows acceptance. Full bundled dependency license texts are included in `resources/THIRD_PARTY_NOTICES.txt`; Electron and Chromium notices remain in the application directory.

## Local data

The stable Windows directory is `%APPDATA%\Qiban`. `history.json` is versioned readable JSON containing separate conversations. Reset affects only the selected character. Up to 200 messages per character are retained. `connection.json` contains the API address/model and an encrypted key only when “记住密钥” is explicitly selected. Without that checkbox, the key lasts until the app closes. Windows uses Electron safeStorage/DPAPI; no plaintext fallback is allowed. This protects against other Windows users, not software already running as the same user.

Back up history while the app is closed. Do not share connection settings or key material. Settings offers a separate key deletion and confirmed deletion of all local data. The uninstall handler removes known Qiban conversations, role files/backups and saved connection settings. Electron may recreate Chromium files as the uninstall process exits. Those residual files have not been audited and may contain private metadata; the test does not establish that all private data is removed. Replacing the application should retain the user-data directory.

## Connection limits

HTTPS public endpoints only. Local/private/reserved DNS answers, embedded credentials, query strings, and redirects are rejected. A changed provider requires a freshly entered key. Native requests resolve and pin the target address, verify TLS, limit response size, and time out after 10 seconds for setup or 25 seconds for chat. This version does not read Windows proxy settings. JSON model lists and non-streaming chat completions are supported; incompatible services produce a readable error. No key, reasoning field, or provider error body is returned to the renderer.

`npm test` covers storage failures, host changes, DNS restrictions, cancellation, history, and real local HTTPS redirect handling using synthetic credentials. `npm run test:desktop` runs Electron onboarding/chat/restart and renderer security checks; on Linux it needs a display and uses the test runner's no-sandbox launch flag. Production windows retain sandbox, context isolation and web security. Passing on Linux is not Windows installer acceptance.

Local V1/V2 JSON character import, preview, original-source export, creation, editing and backups are available under 管理角色. See `CHARACTER_CARDS.md` for supported fields, limits and closed-app maintenance.

## Installer lifecycle CI

`tests/installer-smoke.mjs` is restricted to the disposable Windows CI runner. It refuses existing installations or user data, runs the real Squirrel installer in documented silent mode, sends one offline synthetic message, seeds an original synthetic card and DPAPI-encrypted synthetic key, then verifies relaunch. It generates a higher NuGet package version from the unchanged application payload to check an actual installer upgrade and exact preservation of user-file bytes, then runs the installed updater’s uninstaller and checks removal of both installed executables and all conversation/role/key files. A recreated directory is reported separately; its residual Chromium contents are not audited for private metadata. The upgrade package is ephemeral and is not uploaded.

This uses the hosted runner’s existing administrator account; UAC is disabled by the runner image. It does not create accounts, change security settings, purchase signing or bypass warnings. Passing this test establishes per-user paths and lifecycle behavior under that runner account. It does not establish ordinary-user installation, manual SmartScreen acceptance, Chinese IME behavior or upgrade behavior across future schema changes.

`tests/native-provider-reachability.ts` makes one unpaid request to DeepSeek’s model-list endpoint using the production native HTTPS transport and an explicitly synthetic key. It exercises public DNS validation, TLS and JSON/auth-error handling. It does not call inference, establish valid-key authentication, or prove live reply quality. This is separate from web-adapter model checks; credential-backed native inference remains unverified. The current cloud task blocks direct DNS, so that probe runs on standard Windows CI instead.

For a credential-backed native check, use `tests/native-live-smoke.ts` only after approving its one bounded paid request. Inject the credential through the existing environment's secure launch configuration under `DEEPSEEK_API_KEY` or `deepseek`, then set `QIBAN_ALLOW_ONE_NATIVE_LIVE_CHECK=1` and run `node --import tsx tests/native-live-smoke.ts`. It calls the exact production `requestJson` transport once at the fixed DeepSeek endpoint, limits output to 32 tokens, uses only a synthetic prompt, and logs status/token counts rather than key or reply contents. There are no retries. It needs normal public DNS and direct HTTPS egress; proxy-only network-secret substitution environments are unsupported by this native path. Do not move a network-secret placeholder into another environment, extract a real secret, add CI credentials, disable TLS/DNS checks, or put a key in chat to run it. This check has not been run here.
