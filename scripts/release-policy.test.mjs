import test from "node:test";
import assert from "node:assert/strict";
import { ASSET_NAMES, releaseIdentity, verifyAsset, verifyDraft, verifyManifest } from "./release-policy.mjs";
const commit = "a".repeat(40);
const environment = { GITHUB_REPOSITORY: "ToughClimb/qiban", GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/tags/qiban-preview-0.1.0-${commit}`, GITHUB_SHA: commit };
const identity = releaseIdentity(environment);

test("publication requires the repository, tag and exact reviewed SHA together", () => {
  for (const changes of [{ GITHUB_REPOSITORY: "different/repo" }, { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feat/qiban-mvp" }, { GITHUB_SHA: "b".repeat(40) }]) {
    assert.throws(() => releaseIdentity({ ...environment, ...changes }), /Release gate/);
  }
  assert.deepEqual(identity, { commit, tag: `qiban-preview-0.1.0-${commit}`, version: "0.1.0" });
});

test("existing public releases, foreign builds and altered asset bytes fail closed", () => {
  const draft = { id: 1, draft: true, prerelease: true, tag_name: identity.tag, target_commitish: commit };
  verifyDraft(draft, identity);
  for (const changes of [{ draft: false }, { prerelease: false }, { target_commitish: "main" }, { id: -1 }])
    assert.throws(() => verifyDraft({ ...draft, ...changes }, identity));
  const asset = { name: "Qiban-Android-test.apk", state: "uploaded", size: 100, sha256: "c".repeat(64) };
  verifyAsset({ ...asset, digest: `sha256:${asset.sha256}` }, asset);
  assert.throws(() => verifyAsset({ ...asset, digest: `sha256:${"d".repeat(64)}` }, asset));
  const manifest = { schema_version: 1, ...identity, platform: "android", run_id: "123", package_checks_passed: true,
    assets: ASSET_NAMES.android.map(name => ({ name, size: asset.size, sha256: asset.sha256 })) };
  verifyManifest(manifest, identity, "android", "123");
  assert.throws(() => verifyManifest({ ...manifest, commit: "b".repeat(40) }, identity, "android", "123"));
  assert.throws(() => verifyManifest({ ...manifest, assets: [...manifest.assets, { ...asset, name: "debug.keystore" }] }, identity, "android", "123"));
  assert.throws(() => verifyManifest(manifest, identity, "android", "124"));
  assert.throws(() => verifyManifest({ ...manifest, apiKey: "synthetic-unexpected-field" }, identity, "android", "123"));
  assert.throws(() => verifyManifest({ ...manifest, assets: manifest.assets.map(asset => ({ ...asset, path: "/private/data" })) }, identity, "android", "123"));
});
