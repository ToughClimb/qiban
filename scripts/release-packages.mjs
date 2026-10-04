import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, copyFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ASSET_NAMES, releaseIdentity, verifyManifest } from "./release-policy.mjs";
import { forbiddenArchiveEntry as forbidden, verifyArchiveContents as zipMatches } from "./release-archives.mjs";
const require = createRequire(import.meta.url);
const identity = releaseIdentity(process.env);
const runId = process.env.GITHUB_RUN_ID;
const [command, platform] = process.argv.slice(2);
if (!ASSET_NAMES[platform] || (identity.scope === "windows" && platform !== "windows") || !/^\d+$/.test(runId ?? "") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== identity.commit ||
    JSON.parse(await readFile("package.json", "utf8")).version !== identity.version) {
  throw new Error("Package provenance does not match the reviewed checkout/version.");
}
const info = { schema_version: 1, ...identity, run_id: runId, platform };
const infoFile = platform === "windows" ? "desktop-build/BUILD_INFO.json" : "android/app/src/main/assets/qiban-build-info.json";
if (command === "stamp") {
  await writeFile(infoFile, JSON.stringify(info, null, 2) + "\n");
} else if (command === "prepare") {
  const directory = resolve("release-assets", platform);
  await mkdir(directory, { recursive: true });
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  const source = {};
  if (platform === "windows") {
    const base = "out/Qiban-win32-x64";
    const asarFile = `${base}/resources/app.asar`;
    const asar = require("@electron/asar");
    for (const path of asar.listPackage(asarFile)) {
      const name = path.replace(/^[/\\]/, "").replaceAll("\\", "/");
      if (forbidden(name) || !(name === "package.json" || name === "desktop-build" || name.startsWith("desktop-build/")))
        throw new Error("Unexpected application files in packaged ASAR.");
    }
    const embedded = JSON.parse(asar.extractFile(asarFile, "desktop-build/BUILD_INFO.json").toString("utf8"));
    if (JSON.stringify(embedded) !== JSON.stringify(info)) throw new Error("Windows embedded build identity mismatch.");
    const licenses = new Map();
    for (const path of ["resources/THIRD_PARTY_NOTICES.txt", "LICENSE", "LICENSES.chromium.html"]) {
      const bytes = await readFile(`${base}/${path}`);
      if (bytes.length < 500) throw new Error("Missing full packaged license text.");
      licenses.set(path, bytes);
    }
    const notices = licenses.get("resources/THIRD_PARTY_NOTICES.txt").toString("utf8");
    if (!["react@", "react-dom@", "@capacitor/core@", "MIT License"].every(text => notices.includes(text)))
      throw new Error("Required renderer license attribution is missing.");
    if (!asar.extractFile(asarFile, "desktop-build/THIRD_PARTY_NOTICES.txt").equals(licenses.get("resources/THIRD_PARTY_NOTICES.txt")))
      throw new Error("Windows license copies differ.");
    licenses.set("resources/app.asar", await readFile(asarFile));
    const zip = `out/make/zip/win32/x64/Qiban-win32-x64-${identity.version}.zip`;
    const nupkg = `out/make/squirrel.windows/x64/qiban-${identity.version}-full.nupkg`;
    await zipMatches(zip, licenses);
    await zipMatches(nupkg, licenses);
    source[ASSET_NAMES.windows[0]] = "out/make/squirrel.windows/x64/Qiban-Setup.exe";
    source[ASSET_NAMES.windows[1]] = zip;
    source[ASSET_NAMES.windows[2]] = `${base}/resources/THIRD_PARTY_NOTICES.txt`;
    source[ASSET_NAMES.windows[3]] = `${base}/LICENSE`;
    source[ASSET_NAMES.windows[4]] = `${base}/LICENSES.chromium.html`;
  } else {
    const licenses = new Map();
    const texts = [];
    for (const name of (await readdir("android/app/src/main/assets/licenses")).sort()) {
      const path = `android/app/src/main/assets/licenses/${name}`;
      if (!(await lstat(path)).isFile() || !/\.(txt|md)$/.test(name)) throw new Error("Unexpected Android notice file.");
      const bytes = await readFile(path);
      licenses.set(`assets/licenses/${name}`, bytes);
      texts.push(`--- ${name} ---\n${bytes.toString("utf8")}`);
    }
    if (!["Apache-2.0.txt", "Capacitor-MIT.txt", "React-MIT.txt", "React-DOM-MIT.txt", "NOTICE.md"].every(name => licenses.has(`assets/licenses/${name}`)))
      throw new Error("Required Android license attribution is missing.");
    licenses.set("assets/qiban-build-info.json", await readFile(infoFile));
    const apk = "android/app/build/outputs/apk/debug/app-debug.apk";
    await zipMatches(apk, licenses);
    const notices = join(directory, ASSET_NAMES.android[1]);
    await writeFile(notices, texts.join("\n\n") + "\n");
    const certificate = resolve(process.env.QIBAN_TEST_CERTIFICATE ?? "");
    const certificateText = await readFile(certificate, "utf8");
    if (!certificateText.includes("CN=Android Debug") || !/certificate SHA-256 digest: [a-f0-9]{64}/i.test(certificateText))
      throw new Error("Installable test APK needs a verified disposable debug certificate.");
    source[ASSET_NAMES.android[0]] = apk;
    source[ASSET_NAMES.android[1]] = notices;
    source[ASSET_NAMES.android[2]] = certificate;
  }
  const assets = [];
  for (const [name, file] of Object.entries(source)) {
    const target = join(directory, name);
    if (resolve(file) !== target) await copyFile(file, target);
    const bytes = await readFile(target);
    assets.push({ name, size: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = { ...info, package_checks_passed: true, assets };
  verifyManifest(manifest, identity, platform, runId);
  await writeFile(join(directory, `${platform}-manifest.json`), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`PASS ${platform}: exact embedded SHA, archive payload/license bytes, private-file exclusion, release asset SHA256/size manifest.`);
} else {
  throw new Error("Expected stamp or prepare command.");
}
