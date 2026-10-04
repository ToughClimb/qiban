import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
await build({
  entryPoints: ["desktop/main.ts", "desktop/preload.ts"],
  outdir: "desktop-build",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  legalComments: "eof",
});
