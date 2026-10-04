# Accent color review

This is a bounded follow-up to the accepted lean composition on `04bd44870ae8739fb9ae53961691f365c163a321`. Settings → 外观 contains four accent presets and a native color picker. Paper, body text, typography and layout remain unchanged. Light choices are darkened for readable controls; tinted selection and message surfaces are derived from the safe accent. Only six-digit hex colors and seven fixed CSS properties are accepted.

The renderer stores versioned data under `qiban.appearance.v1` and applies it before React mounts. The preference survives reload and reopening a context with saved origin storage. Successful delete-all clears it before reload; a failed native wipe preserves it. Unavailable storage leaves the current selection usable and reports that it could not be saved.

Windows already uses the stable `qiban://app/index.html` origin. Android must retain a stable origin and enabled DOM storage. Any native wipe path that bypasses the renderer must also clear that origin's storage. No native bindings or platform files were changed in this follow-up.

## Actual rendered screenshots

Production Chromium renderer, synthetic in-memory desktop bridge, original character art, no private content or keys. Desktop is 1280×800; mobile is 390×844. All six captures are also retained in Library.

| Accent | Desktop chat | Mobile chat | Settings |
| --- | --- | --- | --- |
| 雾蓝 | [Desktop](appearance-blue-desktop-chat.png) | [Mobile](appearance-blue-mobile-chat.png) | [Desktop](appearance-blue-desktop-settings.png) |
| 莓红 | [Desktop](appearance-rose-desktop-chat.png) | [Mobile](appearance-rose-mobile-chat.png) | [Mobile](appearance-rose-mobile-settings.png) |

## Verification

- Typecheck, 35 unit tests, web build and desktop renderer build pass.
- Contrast assertions cover 216 light, saturated and dark RGB choices; approved default colors and invalid/corrupted storage data are checked.
- `node tests/appearance-ui-smoke.mjs` covers keyboard preset selection, native picker, reload/reopened-renderer storage, failed/successful delete-all and unavailable storage.
- Existing chat UI smoke and all ten connection/onboarding scenarios pass, with no runtime errors.
- Both screenshot sizes have no horizontal overflow. Native Windows/Android persistence and native wipe acceptance remain with the platform owners; browser renderer checks do not establish that acceptance.
