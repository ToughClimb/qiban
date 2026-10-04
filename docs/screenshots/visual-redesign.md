# Qiban visual review

Branch: `feat/visual-redesign`. Starting feature head: `0eb6dcc0509445d5d0ed8420ca80588711517b4b`.

## Current composition

The companion rail contains avatars and names. The chat contains the character name, conversation, compact composer and necessary controls. Introductory slogans, repeated descriptions, greeting labels, ordinary per-message names, topic suggestions and routine footer instructions were deleted. One concise disclosure identifies the virtual/demo mode; historical replies whose source differs from the current mode retain a source label. Saved message provenance is unchanged.

The composer is 74px high on desktop and 76px on mobile. First launch offers the demo immediately, with optional AI-service fields behind a native keyboard-accessible disclosure. Existing configured services open expanded. API, key, model and connection handlers are preserved.

Avatar controls appear in character management only when the optional platform bridge supports them. `CardPanel.onChangeAvatar(id)` and `onResetAvatar(id)` call the app callbacks; native picker/storage remains outside this branch. Cancellation (`null`) does not report an error or reload the character list. Successful import/reset refreshes the portraits. Only same-character, hashed `qiban://app/avatars/...png` URLs and image data URLs are accepted; remote URLs and failed images use built-in art.

The only dependency imported from platform work is the approved two-file avatar type contract, cherry-picked from `faa19c3a6493057373ca294eb0220ef3a5395439`. No desktop, Android, provider, manifest or bootstrap implementation was merged. Existing original art remains unchanged; no dependencies, remote fonts, analytics or paid images were added.

## Actual rendered evidence

These are Chromium captures of the production renderer at **1280×800** and **390×844**, using a synthetic in-memory desktop bridge. No private content, credentials or private paths appear. They demonstrate renderer presentation, not native Windows/Android acceptance.

**Onboarding** means the modal automatically shown on a fresh launch before any dismissal. **Empty chat** means the demo conversation canvas after choosing demo. Connection settings show the optional service disclosure expanded. These views are named separately.

| View | Before | Current |
| --- | --- | --- |
| Desktop first-launch onboarding | [Before](visual-before-desktop-onboarding.png) | [Current](visual-after-desktop-onboarding.png) |
| Desktop empty chat | [Before](visual-before-desktop-empty-chat.png) | [Current](visual-after-desktop-empty-chat.png) |
| Desktop conversation | [Before](visual-before-desktop-chat.png) | [Current](visual-after-desktop-chat.png) |
| Desktop connection settings | [Before](visual-before-desktop-settings.png) | [Current](visual-after-desktop-connection-settings.png) |
| Mobile first-launch onboarding | [Before](visual-before-mobile-onboarding.png) | [Current](visual-after-mobile-onboarding.png) |
| Mobile empty chat | [Before](visual-before-mobile-empty-chat.png) | [Current](visual-after-mobile-empty-chat.png) |
| Mobile conversation | [Before](visual-before-mobile-chat.png) | [Current](visual-after-mobile-chat.png) |
| Mobile connection settings | [Before](visual-before-mobile-settings.png) | [Current](visual-after-mobile-connection-settings.png) |

Avatar affordance: [desktop character settings](visual-after-desktop-character-settings.png), [mobile character settings](visual-after-mobile-character-settings.png). Card-preview workflows: [desktop](visual-after-desktop-card-preview.png), [mobile](visual-after-mobile-card-preview.png).

## Checks

- `npm run typecheck`, `npm test` (32 tests), `npm run build`, `npm run desktop:build` pass.
- `npm run test:ui` preserves chat isolation, persistence, reset, retry/edit, cancellation, storage failure, invite and mixed demo/live provenance checks.
- `node tests/connection-panel-smoke.mjs` passes the original eight API/key/model scenarios and two demo/disclosure onboarding scenarios.
- `node tests/composer-focus-smoke.mjs` fails against the untouched base at the keyboard-send focus assertion and passes six scenarios on this branch: keyboard send, send button, Tab navigation, outside pointer interaction, character-switch cancellation, and IME/Shift+Enter.
- `node tests/avatar-ui-smoke.mjs` passes seven renderer scenarios: unsupported platform, picker cancellation, import/reset portrait refresh, safe error, broken image, remote URL rejection, and another character's URL rejection. Picker and storage are synthetic in these tests.
- Additional captures exercise card creation/preview/acknowledgement/save/edit, dialog focus containment/Escape, visible composer and both review sizes, with zero browser runtime errors. Caption/control contrast and reduced-motion/safe-area behavior are retained.

The focus fix waits until React enables the composer. It restores focus only for a request started in the composer and cancels restoration when the user navigates elsewhere or leaves the page. IME handlers are unchanged.

Native Electron smoke remains unavailable in this environment because its binary download fails and there is no display server. Native avatar validation/storage and Windows/Android acceptance belong to their platform owners. This remains a draft pending user visual acceptance; no integration merge or release is implied.
