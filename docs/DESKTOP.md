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

The Squirrel installer and ZIP appear below `out/make/`. Installer signing is not configured; Windows may warn about an unknown publisher. No updater or release feed is configured. Installers are not published by CI. Standard-user installation, Chinese IME, uninstall cleanup, and upgrade preservation need separate Windows acceptance.

## Local data

The stable Windows directory is `%APPDATA%\Qiban`. `history.json` is versioned readable JSON containing separate conversations. Reset affects only the selected character. Up to 200 messages per character are retained. `connection.json` contains the API address/model and an encrypted key only when “记住密钥” is explicitly selected. Without that checkbox, the key lasts until the app closes. Windows uses Electron safeStorage/DPAPI; no plaintext fallback is allowed. This protects against other Windows users, not software already running as the same user.

Back up history while the app is closed. Do not share connection settings or key material. Settings offers a separate key deletion and confirmed deletion of all local data. The uninstall handler attempts to remove the local directory; verify this behavior with the actual installer before distribution. Replacing the application should retain this directory.

## Connection limits

HTTPS public endpoints only. Local/private/reserved DNS answers, embedded credentials, query strings, and redirects are rejected. A changed provider requires a freshly entered key. Native requests resolve and pin the target address, verify TLS, limit response size, and time out after 10 seconds for setup or 25 seconds for chat. This version does not read Windows proxy settings. JSON model lists and non-streaming chat completions are supported; incompatible services produce a readable error. No key, reasoning field, or provider error body is returned to the renderer.

`npm test` covers storage failures, host changes, DNS restrictions, cancellation, history, and real local HTTPS redirect handling using synthetic credentials. `npm run test:desktop` runs Electron onboarding/chat/restart and renderer security checks; on Linux it needs a display and uses the test runner's no-sandbox launch flag. Production windows retain sandbox, context isolation and web security. Passing on Linux is not Windows installer acceptance.

Local V1/V2 JSON character import, preview, original-source export, creation, editing and backups are available under 管理角色. See `CHARACTER_CARDS.md` for supported fields, limits and closed-app maintenance.

## Installer lifecycle CI

`tests/installer-smoke.mjs` is restricted to the disposable Windows CI runner. It refuses existing installations or user data, runs the real Squirrel installer in documented silent mode, sends one offline synthetic message, seeds an original synthetic card and DPAPI-encrypted synthetic key, then verifies relaunch. It generates a higher NuGet package version from the unchanged application payload to check an actual installer upgrade and exact preservation of user-file bytes, then runs the installed updater’s uninstaller and checks removal. The upgrade package is ephemeral and is not uploaded.

This uses the hosted runner’s existing administrator account; UAC is disabled by the runner image. It does not create accounts, change security settings, purchase signing or bypass warnings. Passing this test establishes per-user paths and lifecycle behavior under that runner account. It does not establish ordinary-user installation, manual SmartScreen acceptance, Chinese IME behavior or upgrade behavior across future schema changes.
