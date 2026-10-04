import { readFile } from "node:fs/promises";
import { verifyArchiveContents } from "./release-archives.mjs";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const files = ["LICENSE", "LICENSES.chromium.html", "resources/THIRD_PARTY_NOTICES.txt"];
const expected = new Map();
for (const name of files) {
  const bytes = await readFile(`out/Qiban-win32-x64/${name}`);
  if (bytes.length < 500) throw new Error(`Incomplete packaged license: ${name}`);
  expected.set(name, bytes);
}
await verifyArchiveContents(`out/make/zip/win32/x64/Qiban-win32-x64-${version}.zip`, expected);
await verifyArchiveContents(`out/make/squirrel.windows/x64/qiban-${version}-full.nupkg`, expected);
console.log("PASS Windows ZIP and Squirrel NuGet contain the exact full Electron, Chromium and bundled dependency license texts.");
