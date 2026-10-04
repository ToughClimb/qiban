# Reviewed preview releases

Ordinary feature pushes build and test without uploading binaries. `.github/workflows/release.yml` runs only after a maintainer pushes a lightweight tag containing the reviewed commit's full SHA. Do not push that tag until the final image-enabled Windows/Android implementation, UI checks and exact-SHA platform CI have passed and the parent has approved that SHA for publication. A tag push starts the publication process; it is not a dry run.

The release tag is `qiban-preview-<package-version>-<40-character-commit-SHA>`. Its version must match `package.json`. For the approved SHA only:

```sh
reviewed_sha='<approved full commit SHA>'
preview_version='<package.json version>'
git tag "qiban-preview-${preview_version}-${reviewed_sha}" "$reviewed_sha"
git push origin "refs/tags/qiban-preview-${preview_version}-${reviewed_sha}"
```

A separately approved Windows-only delivery uses `qiban-preview-windows-<package-version>-<40-character-commit-SHA>`. It requires all exact-SHA Windows checks, including `Image chat UI regressions` and `Native packaged image chat`, and uploads only Windows assets. It does not deliver an APK or claim Android image acceptance. The combined tag still requires exact-SHA Android CI and emulator acceptance. Do not substitute a Windows-only tag for an approval to publish both platforms.

Do not overwrite or move a release tag. The workflow verifies repository ID `1404734947`, its public visibility, the exact lightweight tag target, and passing Windows/Android push CI for that commit. Android emulator acceptance must have run; a skipped emulator is insufficient.

## Permission check before builds

The first job uses the standard ephemeral `GITHUB_TOKEN`, with only job-scoped `contents: write` and `actions: read`. It creates the intended **draft** prerelease, or verifies and updates an existing matching draft while keeping it unpublished. This is the actual early write-permission check. A denied request stops before either package build. Checkout does not persist credentials. No tokens, provider keys, signing secrets or keystores are stored in the repository or uploaded.

GitHub documents that creating a release targeting a commit with workflow changes relative to the default branch may need `Workflows: write`, which `GITHUB_TOKEN` cannot receive. A 403/404 on draft creation can therefore block this branch-based preview. Do not change repository settings or create a token to work around it. An already-authorized connection with the required permission, or the repository owner through GitHub's release UI, can create the intended draft at the existing tag and exact SHA; rerun the preflight afterwards. The helper requires `draft: true`, `prerelease: true`, the exact tag and `target_commitish` equal to the full SHA. It refuses published or mismatched releases. See [GitHub release permissions](https://docs.github.com/en/rest/releases/releases#create-a-release) and [ephemeral token permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).

This environment's local `gh` authentication is unavailable, and the connected GitHub tools do not expose release creation/upload. No draft permission check has been run here. The gated workflow must establish whether its ephemeral token is sufficient; do not describe publication as working until that check succeeds.

## Package and upload verification

Only standard `windows-2022` and `ubuntu-24.04` runners are used. There is no Actions artifact upload/download, cache upload, signing service or paid inference in this workflow. Package files pass directly from each runner to the same draft GitHub Release. Small public checksum manifests are passed between jobs as outputs. The final job publishes only after both platform jobs pass and every server-reported SHA-256 digest and byte size matches its manifest. Unexpected draft assets block publication. Failures leave the draft unpublished; there are no automatic retries or asset overwrites.

The Windows build stamps the reviewed SHA/tag/run into `desktop-build/BUILD_INFO.json` before packaging. The verifier checks the ASAR file allowlist, full bundled notices, Electron/Chromium license files, and matching payload/license bytes inside both the ZIP and Squirrel NuGet package. It excludes private-data, environment, test and signing-key filenames from the archives. The actual installer and packaged executable are smoke-tested before the same files are hashed and uploaded. This is a bounded package audit, not a forensic scan of every Electron binary.

The Android build embeds `assets/qiban-build-info.json`, verifies exact license text bytes inside the APK, runs native tests and a required API35 emulator smoke, and verifies the installable APK with `apksigner`. Only the debug/test APK and its public certificate report are uploaded. The release unsigned APK and disposable signing keystore remain on the ephemeral runner.

Assets are the Windows x64 installer and ZIP, the installable Android test APK, full notices, public Android test certificate, and per-platform manifests containing SHA, run ID, byte sizes and SHA-256 hashes. Release notes include all checksums and link to the build run. No lifecycle upgrade fixture, user history, role files, local images, connection settings, environment file, or model credential is an upload candidate.

Windows packages are unsigned and have no update feed. Hosted CI does not establish standard-user installation, SmartScreen acceptance or Chinese IME acceptance. Android uses a disposable public debug identity: physical-device acceptance, future upgrades and stable release signing are not established. Windows uninstall removes known Qiban stores; residual Chromium files remain unaudited and may contain private metadata. Keep these limitations in public release notes.

Before tagging, review any newly added image/UI smoke commands against the release workflow; all required image cases must pass. The release helper's local gate/checksum tests run with `node --test scripts/release-policy.test.mjs`. Full package and upload checks require the gated platform jobs and are not established by those unit tests.
