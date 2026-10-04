import { build } from "esbuild";
import { rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
await rm("desktop-build", { recursive: true, force: true });
await mkdir("desktop-build", { recursive: true });
execFileSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--outDir",
    "desktop-build/renderer",
    "--base",
    "./",
  ],
  { stdio: "inherit" },
);
const desktop = await build({
  entryPoints: ["desktop/main.ts", "desktop/preload.ts"],
  outdir: "desktop-build",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  legalComments: "eof",
  metafile: true,
});

const require = createRequire(import.meta.url);
const packages = new Map();
async function includePackage(source) {
  let directory = dirname(resolve(source));
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      packages.set(directory, metadata);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate dependency metadata for ${source}`);
}
for (const source of Object.keys(desktop.metafile.inputs)) {
  if (source.includes("node_modules/")) await includePackage(source);
}
for (const name of ["react", "react-dom", "scheduler"]) {
  await includePackage(require.resolve(name));
}
const notices = [
  "Qiban bundled third-party notices",
  "Electron's LICENSE and LICENSES.chromium.html are provided separately in the application directory.",
];
for (const [directory, metadata] of [...packages].sort((a, b) =>
  `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`),
)) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(licen[cs]e|notice)(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!files.some((name) => /^licen[cs]e/i.test(name))) {
    throw new Error(`Missing full license text for ${metadata.name}@${metadata.version}`);
  }
  notices.push(`\n${metadata.name}@${metadata.version}`);
  for (const name of files) {
    notices.push(`--- ${name} ---\n${await readFile(resolve(directory, name), "utf8")}`);
  }
}
await writeFile("desktop-build/THIRD_PARTY_NOTICES.txt", notices.join("\n\n") + "\n");
