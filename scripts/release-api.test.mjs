import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSET_NAMES, REPOSITORY, REPOSITORY_ID } from "./release-policy.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const script = new URL("./release-api.mjs", import.meta.url);

test("draft preflight, upload and publication use authenticated listing and numeric draft ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qiban-release-api-"));
  const previous = { cwd: process.cwd(), env: { ...process.env }, argv: process.argv, fetch: globalThis.fetch };
  const commit = "a".repeat(40);
  const tag = `qiban-preview-windows-0.1.0-${commit}`;
  let release = { id: 42, tag_name: tag, target_commitish: commit, draft: true, prerelease: true, assets: [] };
  let corruptDigest = false;
  let creations = 0;
  const calls = [];
  let sequence = 0;
  async function run(command) {
    process.argv = [process.execPath, script.pathname, command, "windows"];
    await import(`${script.href}?fixture=${sequence++}`);
  }
  try {
    process.chdir(directory);
    Object.assign(process.env, { GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: "push",
      GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: commit, GITHUB_RUN_ID: "123",
      GH_TOKEN: "synthetic-release-test-token", GITHUB_OUTPUT: join(directory, "output"),
      GITHUB_STEP_SUMMARY: join(directory, "summary") });
    delete process.env.QIBAN_RELEASE_ID;
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      assert.equal(options.headers.Authorization, "Bearer synthetic-release-test-token");
      assert.equal(options.redirect, "error");
      assert.ok(["api.github.com", "uploads.github.com"].includes(parsed.hostname));
      const path = parsed.pathname.replace(`/repos/${REPOSITORY}`, "");
      calls.push(`${options.method} ${path}`);
      assert.ok(!path.startsWith("/releases/tags/"), "published-only tag lookup cannot find a draft");
      let data;
      if (path === "") data = { id: REPOSITORY_ID, full_name: REPOSITORY, private: false };
      else if (path === `/git/ref/tags/${tag}`) data = { object: { type: "commit", sha: commit } };
      else if (path === "/actions/runs") data = { workflow_runs: [{ id: 7, name: "Windows desktop verification",
        event: "push", head_sha: commit, status: "completed", conclusion: "success" }] };
      else if (path === "/actions/runs/7/jobs") data = { jobs: [{ conclusion: "success", steps:
        ["Verify ZIP and installer licenses", "Image chat UI regressions", "Native packaged image chat"]
          .map(name => ({ name, conclusion: "success" })) }] };
      else if (path === "/releases" && options.method === "GET") data = release ? [release] : [];
      else if (path === "/releases" && options.method === "POST") {
        creations++;
        release = { id: 42, ...JSON.parse(options.body), assets: [] };
        data = release;
      } else if (path === "/releases/42" && options.method === "GET") data = release;
      else if (path === "/releases/42" && options.method === "PATCH") {
        Object.assign(release, JSON.parse(options.body), { html_url: "https://github.com/ToughClimb/qiban/releases/test" });
        data = release;
      } else if (path === "/releases/42/assets" && options.method === "POST") {
        assert.equal(parsed.hostname, "uploads.github.com");
        const chunks = [];
        for await (const chunk of options.body) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        assert.equal(Number(options.headers["Content-Length"]), bytes.length);
        data = { name: parsed.searchParams.get("name"), state: "uploaded", size: bytes.length,
          digest: `sha256:${corruptDigest ? "b".repeat(64) : hash(bytes)}` };
        release.assets.push(data);
      } else throw new Error(`Unexpected test request: ${options.method} ${path}`);
      return new Response(JSON.stringify(data), { status: 200 });
    };

    await run("preflight");
    assert.equal(creations, 0, "an existing draft is reused, never duplicated");
    const output = await readFile(process.env.GITHUB_OUTPUT, "utf8");
    assert.match(output, /scope=windows\nrelease_id=42\n/);
    await assert.rejects(run("upload"), /ENOENT/);
    const assetDirectory = join(directory, "release-assets", "windows");
    await mkdir(assetDirectory, { recursive: true });
    const assets = [];
    for (const name of ASSET_NAMES.windows) {
      const bytes = Buffer.from(`synthetic package fixture ${name}\n`);
      await writeFile(join(assetDirectory, name), bytes);
      assets.push({ name, size: bytes.length, sha256: hash(bytes) });
    }
    const manifest = { schema_version: 1, tag, version: "0.1.0", commit, scope: "windows", run_id: "123",
      platform: "windows", package_checks_passed: true, assets };
    await writeFile(join(assetDirectory, "windows-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await assert.rejects(run("upload"), /draft ID returned by preflight/);
    process.env.QIBAN_RELEASE_ID = "42";
    await run("upload");
    assert.equal(release.assets.length, assets.length + 1);
    await run("upload");
    assert.equal(release.assets.length, assets.length + 1, "verified uploads are reusable");
    process.env.QIBAN_WINDOWS_MANIFEST = JSON.stringify(manifest);
    release.assets[0].digest = `sha256:${"b".repeat(64)}`;
    await assert.rejects(run("publish"), /checksum\/size verification failed/);
    assert.equal(release.draft, true);
    release.assets[0].digest = `sha256:${assets[0].sha256}`;
    await run("publish");
    assert.equal(release.draft, false);
    assert.equal(release.prerelease, true);
    assert.ok(calls.includes("GET /releases/42"));
    await assert.rejects(run("preflight"), /Refusing to modify a published release/);

    // The creation path uses the same numeric-ID handoff and fails immediately on a bad upload digest.
    release = null;
    await run("preflight");
    assert.equal(creations, 1);
    corruptDigest = true;
    await assert.rejects(run("upload"), /checksum\/size verification failed/);
    assert.equal(release.draft, true);
    assert.equal(release.assets.length, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    process.argv = previous.argv;
    for (const key of Object.keys(process.env)) if (!(key in previous.env)) delete process.env[key];
    Object.assign(process.env, previous.env);
    process.chdir(previous.cwd);
    await rm(directory, { recursive: true, force: true });
  }
});
