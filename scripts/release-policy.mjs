export const REPOSITORY = "ToughClimb/qiban";
export const REPOSITORY_ID = 1404734947;

export function releaseIdentity(environment) {
  const { GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_SHA } = environment;
  const match = /^refs\/tags\/(qiban-preview-(windows-)?(\d+\.\d+\.\d+)-([a-f0-9]{40}))$/.exec(GITHUB_REF ?? "");
  if (GITHUB_REPOSITORY !== REPOSITORY || GITHUB_EVENT_NAME !== "push" ||
      !match || match[4] !== GITHUB_SHA) {
    throw new Error("Release gate requires this repository's lightweight preview tag containing the exact reviewed commit SHA.");
  }
  return { tag: match[1], version: match[3], commit: GITHUB_SHA, scope: match[2] ? "windows" : "both" };
}

export function verifyDraft(release, identity) {
  if (!Number.isSafeInteger(release.id) || release.id < 1 || !release.draft ||
      !release.prerelease || release.tag_name !== identity.tag ||
      release.target_commitish !== identity.commit) {
    throw new Error("Refusing to modify a published release or a draft for another commit.");
  }
}

export function verifyAsset(asset, expected) {
  if (asset.name !== expected.name || asset.state !== "uploaded" || asset.size !== expected.size ||
      asset.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`Release asset checksum/size verification failed: ${expected.name}`);
  }
}

export const ASSET_NAMES = {
  windows: ["Qiban-Windows-x64-Setup.exe", "Qiban-Windows-x64.zip", "Windows-THIRD_PARTY_NOTICES.txt", "Electron-LICENSE.txt", "Chromium-LICENSES.html"],
  android: ["Qiban-Android-test.apk", "Android-THIRD_PARTY_NOTICES.txt", "Android-test-certificate.txt"],
};

export function verifyManifest(manifest, identity, platform, runId) {
  const allowed = Object.hasOwn(ASSET_NAMES, platform) && ASSET_NAMES[platform];
  const fields = ["schema_version", "commit", "tag", "version", "scope", "run_id", "platform", "package_checks_passed", "assets"];
  if (!allowed || !manifest || typeof manifest !== "object" || Object.keys(manifest).some(key => !fields.includes(key)) ||
      manifest.schema_version !== 1 || manifest.commit !== identity.commit || manifest.version !== identity.version ||
      manifest.scope !== identity.scope || (identity.scope === "windows" && platform !== "windows") ||
      manifest.tag !== identity.tag || manifest.run_id !== runId || manifest.platform !== platform ||
      manifest.package_checks_passed !== true || !Array.isArray(manifest.assets) ||
      manifest.assets.length !== allowed.length) {
    throw new Error("Release manifest does not match this exact build and platform.");
  }
  const names = manifest.assets.map(asset => asset.name);
  if (new Set(names).size !== names.length || allowed.some(name => !names.includes(name)) ||
      manifest.assets.some(asset => Object.keys(asset).some(key => !["name", "size", "sha256"].includes(key)) ||
        !Number.isSafeInteger(asset.size) || asset.size < 1 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256))) {
    throw new Error("Release manifest has unexpected assets or invalid checksums.");
  }
}
