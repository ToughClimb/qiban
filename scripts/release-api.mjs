import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { ASSET_NAMES, REPOSITORY, REPOSITORY_ID, releaseIdentity, verifyDraft, verifyAsset, verifyManifest } from "./release-policy.mjs";
const identity = releaseIdentity(process.env);
const token = process.env.GH_TOKEN;
const runId = process.env.GITHUB_RUN_ID;
const platforms = identity.scope === "windows" ? ["windows"] : ["windows", "android"];
if (!token || !/^\d+$/.test(runId ?? "")) throw new Error("Release job needs its ephemeral GITHUB_TOKEN and run identity.");
const root = `https://api.github.com/repos/${REPOSITORY}`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function request(path, method = "GET", body, upload = false, uploadSize) {
  const response = await fetch(upload ? path : `${root}${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(upload ? 300000 : 30000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": upload ? "application/octet-stream" : "application/json",
      ...(upload ? { "Content-Length": String(uploadSize) } : {}) },
    ...(body === undefined ? {} : upload ? { body, duplex: "half" } : { body: JSON.stringify(body) }),
  });
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("GitHub release metadata exceeded its bound.");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString("utf8");
  if (!response.ok) {
    if (response.status === 404 && method === "GET") return null;
    throw new Error(`GitHub release ${method} failed (HTTP ${response.status}). No retry, settings change or new credentials attempted. A 403/404 on draft creation can mean contents/workflow write permission is unavailable.`);
  }
  return JSON.parse(data);
}

async function draft() {
  const id = process.env.QIBAN_RELEASE_ID;
  if (!/^[1-9]\d*$/.test(id ?? "") || !Number.isSafeInteger(Number(id)))
    throw new Error("Release job needs the draft ID returned by preflight.");
  const release = await request(`/releases/${id}`);
  if (!release) throw new Error("The preflight draft is missing.");
  verifyDraft(release, identity);
  if (release.id !== Number(id)) throw new Error("GitHub returned a different release ID.");
  return release;
}

const command = process.argv[2];
if (command === "preflight") {
  const repository = await request("");
  if (repository?.id !== REPOSITORY_ID || repository.full_name !== REPOSITORY || repository.private)
    throw new Error("Release repository identity/visibility changed; stopping without modifying settings.");
  const tag = await request(`/git/ref/tags/${identity.tag}`);
  if (tag?.object?.type !== "commit" || tag.object.sha !== identity.commit)
    throw new Error("Release needs an existing lightweight tag at the exact reviewed SHA.");
  const runs = await request(`/actions/runs?head_sha=${identity.commit}&per_page=100`);
  for (const name of identity.scope === "windows" ? ["Windows desktop verification"] : ["Windows desktop verification", "Android checks"]) {
    const run = runs?.workflow_runs?.find(run => run.name === name && run.event === "push");
    if (!run || run.head_sha !== identity.commit || run.status !== "completed" || run.conclusion !== "success")
      throw new Error(`Exact-SHA ${name} must pass before the release tag is pushed.`);
    const jobs = await request(`/actions/runs/${run.id}/jobs`);
    if (!jobs?.jobs?.length || jobs.jobs.some(job => job.conclusion !== "success"))
      throw new Error("Required exact-SHA verification jobs did not pass.");
    if (name === "Windows desktop verification" && ["Verify ZIP and installer licenses", "Image chat UI regressions", "Native packaged image chat"].some(required =>
      !jobs.jobs.some(job => job.steps.some(step => step.name === required && step.conclusion === "success"))))
      throw new Error("Exact-SHA image UI and actual packaged native image verification are required before release.");
    if (name === "Android checks" && !jobs.jobs.some(job => job.steps.some(step =>
      step.name === "API35 installation and native demo smoke" && step.conclusion === "success")))
      throw new Error("Exact-SHA API35 emulator verification is required; a skipped emulator is insufficient.");
  }
  // The tag endpoint only returns published releases. Authenticated listings include drafts.
  const releases = await request("/releases?per_page=100");
  if (!Array.isArray(releases)) throw new Error("GitHub did not return a release listing.");
  let release = releases.find(item => item.tag_name === identity.tag);
  if (!release && releases.length >= 100)
    throw new Error("Release listing exceeds the lookup bound; refusing to create a possible duplicate draft.");
  if (release) {
    verifyDraft(release, identity);
    release = await request(`/releases/${release.id}`, "PATCH", { draft: true, prerelease: true });
  } else {
    // This intended draft is also the early write-permission check. It is never a throwaway probe release.
    release = await request("/releases", "POST", {
      tag_name: identity.tag, target_commitish: identity.commit,
      name: `栖伴 Qiban ${identity.version} ${identity.scope === "windows" ? "Windows " : ""}preview`, draft: true, prerelease: true,
      generate_release_notes: false, make_latest: "false",
      body: `Reviewed commit: ${identity.commit}\n\nBuilds and asset verification are pending.`,
    });
  }
  verifyDraft(release, identity);
  await appendFile(process.env.GITHUB_OUTPUT, `scope=${identity.scope}\nrelease_id=${release.id}\n`);
  console.log(`PASS release preflight: repository ID, reviewed tag, exact-SHA CI/emulator and draft contents-write permission. ${identity.commit}`);
} else if (command === "upload") {
  const platform = process.argv[3];
  const directory = join("release-assets", platform);
  const manifestFile = `${platform}-manifest.json`;
  const manifestBytes = await readFile(join(directory, manifestFile));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  verifyManifest(manifest, identity, platform, runId);
  const release = await draft();
  const assets = [...manifest.assets, { name: manifestFile, size: manifestBytes.length, sha256: sha256(manifestBytes) }];
  for (const asset of assets) {
    const file = join(directory, asset.name);
    const bytes = await readFile(file);
    if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) throw new Error("Local release asset changed after verification.");
    const existing = release.assets.find(item => item.name === asset.name);
    if (existing) { verifyAsset(existing, asset); continue; }
    const url = `https://uploads.github.com/repos/${REPOSITORY}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;
    verifyAsset(await request(url, "POST", createReadStream(file), true, asset.size), asset);
  }
  await appendFile(process.env.GITHUB_OUTPUT, `manifest=${JSON.stringify(manifest)}\n`);
  console.log(`PASS ${platform}: direct draft Release upload; every server digest and size matches. No Actions artifact storage.`);
} else if (command === "publish") {
  const release = await draft();
  const expected = [];
  const manifests = [];
  for (const platform of platforms) {
    const manifest = JSON.parse(process.env[`QIBAN_${platform.toUpperCase()}_MANIFEST`] ?? "null");
    verifyManifest(manifest ?? {}, identity, platform, runId);
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    expected.push(...manifest.assets, { name: `${platform}-manifest.json`, size: bytes.length, sha256: sha256(bytes) });
    manifests.push(manifest);
  }
  if (release.assets.length !== expected.length) throw new Error("Unexpected or missing draft assets; refusing publication.");
  for (const asset of expected) {
    const uploaded = release.assets.find(item => item.name === asset.name);
    if (!uploaded) throw new Error(`Missing release asset: ${asset.name}`);
    verifyAsset(uploaded, asset);
  }
  const table = expected.map(asset => `| ${asset.name} | ${asset.size} | \`${asset.sha256}\` |`).join("\n");
  const body = `栖伴 Qiban ${identity.version} 预览版\n\n` +
    `虚拟角色与宠物聊天。本地演示不调用模型；真实聊天须在应用内配置自己的兼容服务。\n\n` +
    `Commit: \`${identity.commit}\`\nVerification/build: https://github.com/${REPOSITORY}/actions/runs/${runId}\n\n` +
    `使用说明：[Windows](https://github.com/${REPOSITORY}/blob/${identity.commit}/docs/USER_GUIDE.zh-CN.md)` +
    (identity.scope === "both" ? ` · [Android](https://github.com/${REPOSITORY}/blob/${identity.commit}/docs/ANDROID_USER_GUIDE.zh-CN.md)` : "") + `\n\n` +
    `Windows x64 installer/ZIP are unsigned. No update feed is configured. Standard-user/SmartScreen/Chinese IME acceptance is not established by hosted CI.\n\n` +
    (identity.scope === "windows" ? `This prerelease delivers Windows only. Android image chat remains under verification; no Android APK is included or claimed here.\n\n` :
      `Android APK is an installable debug/test build with a disposable public test certificate. No stable signing identity or future upgrade compatibility is promised. API35 emulator verification is required; this is not physical-device acceptance.\n\n`) +
    `Only offline/synthetic and unpaid transport checks run in this workflow. It performs no paid inference. Full third-party notices are included in packages and supplied below.\n\n` +
    `Windows uninstall removes known Qiban stores; residual Chromium files have not been audited and may contain private metadata.\n\n` +
    `| Asset | Bytes | SHA256 |\n| --- | ---: | --- |\n${table}\n`;
  const published = await request(`/releases/${release.id}`, "PATCH", { draft: false, prerelease: true, make_latest: "false", body });
  if (published.draft || !published.prerelease) throw new Error("GitHub did not confirm prerelease publication.");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `Published exact-SHA prerelease: ${published.html_url}\n\n${body}\n`);
  console.log(`Published verified prerelease: ${published.html_url}`);
} else {
  throw new Error("Expected preflight, upload or publish command.");
}
