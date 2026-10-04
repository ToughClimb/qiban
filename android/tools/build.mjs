import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const android = fileURLToPath(new URL("../", import.meta.url));
const task = process.argv[2];
if (!["debug", "unsigned", "test"].includes(task))
  throw new Error("Choose debug, unsigned, or test.");
const executable = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const result = spawnSync(
  executable,
  [
    "--no-daemon",
    task === "test"
      ? "testDebugUnitTest"
      : task === "debug"
        ? "assembleDebug"
        : "assembleRelease",
  ],
  { cwd: android, stdio: "inherit", shell: process.platform === "win32" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
