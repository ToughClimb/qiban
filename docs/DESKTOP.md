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

JSON character-card parsing is present with V1/V2 examples. The native picker/editor integration is still being implemented; see `CHARACTER_CARDS.md` for supported fields and limits.
