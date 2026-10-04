# 栖伴 Qiban

A small Chinese roleplay chat app with four original virtual companions: 林野 (walking buddy), 陶陶 (creative friend), 豆包 (dog), and 月饼 (cat). Characters are explicitly virtual. The default demo uses preset examples and labels them as such.

A Windows desktop preview with local connection setup is available from source; see [desktop instructions](docs/DESKTOP.md). Local JSON card editing is included. Installer acceptance is still in progress.

## Run

Use Node 24 LTS and npm. From this repository:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. One process serves both Vite and the API. No credentials are needed for demo mode. `HOST` defaults to loopback; no public endpoint is provisioned.

To run the compiled app:

```sh
npm run build
npm start
```

## What is included

- A responsive character picker and chat, keyboard sending with Chinese IME support, and suggested opening topics.
- Separate conversations in this browser's local storage, with confirmed reset for the selected character. Up to 200 messages per character are retained; recent complete turns are sent as context.
- Loading, connection failure, and manual retry. An unanswered message survives reload. Switching characters cancels the request and ignores late responses.
- A shared invite-code gate for live mode. The invite stays in page memory and is cleared on a rejected request. Reload requires entering it again.

Use one browser tab for this MVP. Tabs do not synchronize storage: concurrent writes can overwrite histories or restore a record cleared in another tab. Browser records are unencrypted. This version is for private testing, with a shared invite rather than individual accounts.

There are no accounts, payments, autonomous tools, database, or cross-device sync. Messages arrive complete; this version does not stream. Demo replies have limited contextual behavior and cannot establish live personality quality.

## Code map

| Files                                                                              | Responsibility                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `shared/characters.ts`, `shared/chat.ts`                                           | Original character definitions and public message types/limits                |
| `src/App.tsx`, `src/CharacterPicker.tsx`, `src/ChatMessages.tsx`, `src/styles.css` | Picker, conversation UI, responsive layout                                    |
| `src/conversations.ts`                                                             | Character-specific browser persistence and reset                              |
| `src/api.ts`                                                                       | Bounded history, timeout/cancellation, safe public errors                     |
| `server/app.ts`, `server/validation.ts`                                            | API, access gate, validation, concurrency/rate limits                         |
| `server/provider.ts`, `server/personas.ts`                                         | Preset demo or fixed DeepSeek provider; server-owned personality instructions |
| `server/index.ts`                                                                  | Development middleware or production static serving                           |
| `tests/`                                                                           | Unit/integration tests, browser smoke checks, separate opt-in live smoke      |

The browser calls same-origin `/api/config` and `/api/chat`. The server never stores conversation bodies. Demo stays local to the app server; live sends the selected character's recent conversation to DeepSeek. The browser renders text, not provider HTML. It receives final reply text and mode, never reasoning fields or provider error bodies. Each new reply stores its actual demo/live source and labels it in the transcript; replies predating this field are labeled as historical. The response mode also updates the current mode banner. The exact displayed opening greeting is included in server-controlled framing for continuity. Prompt guidance asks characters to respect real-life relationships and avoid guilt, exclusivity, or dependency tactics; model behavior still needs review.

## DeepSeek setup

Keep `QIBAN_MODE=demo` until credentials are securely configured. Live startup requires `DEEPSEEK_API_KEY` (or the existing lowercase `deepseek` binding), `QIBAN_MODE=live`, and `QIBAN_ACCESS_TOKEN` (at least 24 characters). Credential precedence is deterministic: a nonempty `DEEPSEEK_API_KEY` takes precedence over nonempty `deepseek`. Only these two names are read; there is no credential scanning. The manual smoke check uses the same lookup. The invite token is separate from the provider credential; never give the provider key to browser users.

In Codex Cloud: Settings → Codex Cloud → Environments → qiban → … → Edit → Network secrets → Manage. Set key `DEEPSEEK_API_KEY` and allowed domain `api.deepseek.com`; save and Republish. Configure the invite as a direct environment variable. Do not put secrets in source code, chat, or `VITE_*` variables. Cloud network secrets supply placeholders that the HTTPS proxy substitutes; the adapter uses Undici's `EnvHttpProxyAgent` and the environment's CA configuration. [Cloud configuration documentation](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets) states that a fresh task is needed after republishing; existing tasks retain their state.

For development outside this cloud, an ignored local `.env` can hold the server values. `.env.example` contains names only. Preserve certificate verification; do not bypass the HTTPS proxy in cloud tasks.

The fixed endpoint is `https://api.deepseek.com/chat/completions`; the configured model is `deepseek-flash`, as named in the [official quickstart](https://api-docs.deepseek.com/) when implemented on 2026-10-04. [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) is explicitly disabled. Output is capped at 256 tokens, requests time out after 25 seconds, and no provider retries happen automatically. The server accepts at most 40 alternating turns and 32 KiB of UTF-8 context and 48 KiB for the encoded JSON body, with a 2,000-character limit on each new user message; the browser uses the same shared byte limits, including JSON escaping, and drops complete old turns to fit. An oversized pending message can be edited and resent without deleting earlier conversation. Requests cannot supply a model, fetch URL, system prompt, or tools.

Live inference requires the invite on every request. A single server process allows at most 20 authenticated requests per minute and three concurrent calls. These are small private-test safeguards, not durable billing or multi-instance access controls. There is no persistent currency ledger; inspect provider usage before authorizing more tests. Do not deploy this as public paid inference.

## Verification

```sh
npm test
npm run build
npm run test:ui
```

`npm test` uses mocked provider responses and makes no paid calls. Browser smoke checks start the compiled server in demo mode, use Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`), save ignored screenshots under `artifacts/`, and stop the server. Build first. The live access UI is exercised with browser mocks.

For a fresh cloud task with the replacement binding and explicit paid-test authorization:

```sh
QIBAN_LIVE_SMOKE_AUTHORIZED=yes npm run test:live
```

This manual smoke check sends exactly three ordinary synthetic conversations if all succeed: human persona, one context follow-up, and dog persona. It caps total requested output at 768 tokens, stops at the first failure, does not retry, and never reads stored user conversations. It does not start or expose a web endpoint. The project's authorized CNY 20 ceiling is a maximum, not a spending goal; this script is for one small run, not repeated unattended use. Its output is synthetic final reply text for manual assessment, not secret values or reasoning.

At this implementation checkpoint: 13 unit/integration tests and production browser checks passed; no paid DeepSeek calls were made in this implementation task. A separate fresh task reported proxy connectivity; app-level live behavior has not yet been verified here. Actual model performance, proxy authentication, cost, and live latency remain unverified. Clearing browser storage also clears conversations, and storage failures are reported in the UI. Long-term memory and content moderation beyond prompt guidance are outside this first version.
