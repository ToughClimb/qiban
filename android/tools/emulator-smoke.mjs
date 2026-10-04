// Runs only against a freshly booted test AVD. No provider key or external inference.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = "app.qiban.mobile";
const adb = (...args) =>
  execFileSync("adb", args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
const pause = () => new Promise((resolve) => setTimeout(resolve, 2000));
const target = join(process.env.RUNNER_TEMP ?? "/tmp", "qiban-emulator-ui.xml");
function ui() {
  adb("shell", "uiautomator", "dump", "/sdcard/qiban-smoke.xml");
  adb("pull", "/sdcard/qiban-smoke.xml", target);
  return readFileSync(target, "utf8");
}
function button(xml, label) {
  const node = xml.match(
    new RegExp(`<node\\b[^>]*(?:text|content-desc)="${label}"[^>]*>`),
  )?.[0];
  const box = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!box) return undefined;
  const [x1, y1, x2, y2] = box.slice(1).map(Number);
  return x2 > x1 && y2 > y1
    ? [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)]
    : undefined;
}

assert.match(
  adb(
    "install",
    "-r",
    "-t",
    "android/app/build/outputs/apk/debug/app-debug.apk",
  ),
  /Success/,
);
assert.match(adb("shell", "pm", "path", app), /^package:/m);
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
adb("shell", "wm", "dismiss-keyguard");
adb("logcat", "-c");
adb("logcat", "-b", "crash", "-c");
assert.match(
  adb("shell", "am", "start", "-W", "-n", `${app}/.MainActivity`),
  /Status: ok/,
);
let xml = "",
  position;
for (let attempt = 0; attempt < 20; attempt++) {
  await pause();
  xml = ui();
  position = button(xml, "先用演示聊天");
  if (position) break;
  if (attempt > 5)
    adb("shell", "input", "swipe", "540", "1700", "540", "800", "300");
}
assert.ok(position, "Android onboarding must render its native-demo control");
adb("shell", "input", "tap", ...position.map(String));
let closed = false;
for (let attempt = 0; attempt < 15; attempt++) {
  await pause();
  xml = ui();
  if (!xml.includes("先用演示聊天") && xml.includes("连接与数据")) {
    closed = true;
    break;
  }
}
assert.ok(closed, "Native demo bridge must resolve and close onboarding");
assert.ok(adb("shell", "pidof", app).trim(), "App process must remain alive");
const resumed = adb("shell", "dumpsys", "activity", "activities")
  .split("\n")
  .filter((line) => /mResumedActivity|topResumedActivity/.test(line))
  .join("\n");
assert.match(
  resumed,
  /app\.qiban\.mobile\/(?:\.|app\.qiban\.mobile\.)MainActivity/,
);
assert.doesNotMatch(
  adb("logcat", "-b", "crash", "-d"),
  /Process: app\.qiban\.mobile(?:[,:\s]|$)/,
);
console.log(
  "PASS API35 emulator: APK install, rendered Android onboarding, native offline-demo handoff, foreground activity and no recorded app crash. Not physical-device acceptance.",
);
