import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  access,
  mkdir,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import installer from "electron-winstaller";

// Only the disposable Windows CI profile may run this destructive lifecycle test.
if (process.platform !== "win32" || process.env.CI !== "true") {
  throw new Error(
    "Installer lifecycle smoke requires a disposable Windows CI runner.",
  );
}
const run = promisify(execFile);
const installRoot = join(process.env.LOCALAPPDATA, "qiban");
const dataRoot = join(process.env.APPDATA, "Qiban");
const packaged = resolve("out/Qiban-win32-x64");
const releaseDirectory = resolve("out/make/squirrel.windows/x64");
const upgradeDirectory = resolve("out/lifecycle-upgrade");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const [major, minor, patch] = version.split(".").map(Number);
const upgradeVersion = `${major}.${minor}.${patch + 1}`;
const cardId = "card-12345678-1234-1234-1234-123456789abc";
const imageId = "image-12345678-1234-1234-1234-123456789abc";
let application;
let installed = false;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function command(file, args, timeout = 90_000) {
  try {
    await run(file, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
  } catch {
    throw new Error(
      `Installer lifecycle command failed or timed out: ${args.includes("--uninstall") ? "uninstall" : "install"}. No security settings or warning bypasses were attempted.`,
    );
  }
}
async function launch(packageVersion) {
  application = await _electron.launch({
    executablePath: join(installRoot, `app-${packageVersion}`, "Qiban.exe"),
    args: [],
    timeout: 20_000,
  });
  const actual = await application.evaluate(({ app }) =>
    app.getPath("userData"),
  );
  assert.equal(
    actual.toLowerCase(),
    dataRoot.toLowerCase(),
    "Installed app must use the stable Windows data directory",
  );
  const page = await application.firstWindow();
  await expect(
    page.getByRole("heading", { name: "林野", exact: true }),
  ).toBeVisible();
  return page;
}
async function close() {
  await application?.close();
  application = undefined;
}

assert.equal(
  await exists(installRoot),
  false,
  "Refusing to replace an existing installation",
);
assert.equal(
  await exists(dataRoot),
  false,
  "Refusing to touch existing Qiban user data",
);
console.log(
  "LIMIT Windows hosted runner is administrator with UAC disabled; this is per-user lifecycle evidence, not ordinary-user or SmartScreen acceptance.",
);
try {
  await command(join(releaseDirectory, "Qiban-Setup.exe"), ["--silent"]);
  installed = true;
  assert.equal(
    await exists(join(installRoot, "Update.exe")),
    true,
    "Installer must create a per-user updater",
  );
  let page = await launch(version);
  await page.getByRole("button", { name: "先用演示聊天" }).click();
  await page
    .getByRole("textbox", { name: /发消息/ })
    .fill("synthetic installer lifecycle message");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message.assistant .bubble")).toHaveCount(2);
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => window.qiban.loadHistory());
      return result.ok && result.value.lin?.length === 2;
    })
    .toBe(true);
  const encrypted = await application.evaluate(({ safeStorage }) =>
    safeStorage
      .encryptString("synthetic-lifecycle-key-only")
      .toString("base64"),
  );
  await close();
  await mkdir(join(dataRoot, "cards"), { recursive: true });
  await mkdir(join(dataRoot, "avatars"), { recursive: true });
  await writeFile(join(dataRoot, "avatars", `${cardId}.png`), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSQv4DwAD5gH6hp8d8QAAAABJRU5ErkJggg==", "base64"));
  await writeFile(
    join(dataRoot, "cards", `${cardId}.json`),
    JSON.stringify({
      name: "Synthetic lifecycle character",
      first_mes: "synthetic greeting",
    }),
  );
  await writeFile(
    join(dataRoot, "connection.json"),
    JSON.stringify({
      schema_version: 1,
      baseUrl: "https://provider.invalid",
      model: "fixture",
      models: ["fixture"],
      enabled: false,
      key: encrypted,
    }),
  );
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSQv4DwAD5gH6hp8d8QAAAABJRU5ErkJggg==", "base64");
  const historyFile = join(dataRoot, "history.json");
  const imageHistory = JSON.parse(await readFile(historyFile, "utf8"));
  imageHistory.conversations.lin[0].image = {
    id: imageId, mimeType: "image/png", byteLength: imageBytes.length, width: 1, height: 1,
  };
  await mkdir(join(dataRoot, "chat-images", "lin"), { recursive: true });
  await writeFile(join(dataRoot, "chat-images", "lin", `${imageId}.png`), imageBytes);
  await writeFile(historyFile, JSON.stringify(imageHistory, null, 2));
  const files = [
    "history.json",
    "connection.json",
    join("cards", `${cardId}.json`),
    join("avatars", `${cardId}.png`),
    join("chat-images", "lin", `${imageId}.png`),
  ];
  const snapshot = await Promise.all(
    files.map((file) => readFile(join(dataRoot, file))),
  );
  page = await launch(version);
  await expect(
    page.getByText("synthetic installer lifecycle message", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Synthetic lifecycle character/ }),
  ).toBeVisible();
  const status = await page.evaluate(() => window.qiban.status());
  assert.equal(status.ok && status.value.remembered, true);
  assert.equal(status.ok && status.value.mode, "demo");
  await close();
  console.log(
    "PASS installer: per-user installation and relaunch preserve synthetic history/image, card ID and encrypted key; no model requests.",
  );

  // Same frozen app payload, higher NuGet version: exercise an actual Squirrel upgrade.
  await installer.createWindowsInstaller({
    appDirectory: packaged,
    outputDirectory: upgradeDirectory,
    version: upgradeVersion,
    name: "qiban",
    exe: "Qiban.exe",
    setupExe: "Qiban-Lifecycle-Upgrade-Setup.exe",
    noMsi: true,
    skipUpdateIcon: true,
    setupIcon: resolve("build/qiban.ico"),
  });
  await command(join(upgradeDirectory, "Qiban-Lifecycle-Upgrade-Setup.exe"), [
    "--silent",
  ]);
  assert.equal(
    await exists(join(installRoot, `app-${upgradeVersion}`, "Qiban.exe")),
    true,
  );
  assert.deepEqual(
    await Promise.all(
      files.map((file) => readFile(join(dataRoot, file))),
    ),
    snapshot,
    "Upgrade must preserve exact synthetic user-file bytes",
  );
  page = await launch(upgradeVersion);
  await expect(
    page.getByText("synthetic installer lifecycle message", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Synthetic lifecycle character/ }),
  ).toBeVisible();
  assert.equal(
    (await page.evaluate(() => window.qiban.status())).value?.remembered,
    true,
  );
  await close();
  console.log(
    `PASS upgrade: synthetic NuGet ${version} -> ${upgradeVersion}, unchanged app code, stable directory and exact history/card/encrypted-setting bytes preserved.`,
  );

  await command(join(installRoot, "Update.exe"), ["--uninstall", "--silent"]);
  installed = false;
  // Electron can recreate a bookkeeping directory while its uninstall process exits.
  // Validate the actual user-data and application deletion, not directory identity alone.
  const sensitive = [
    "history.json",
    "history.json.tmp",
    "connection.json",
    "connection.json.tmp",
    "cards",
    "avatars",
    "chat-images",
  ];
  await expect
    .poll(
      async () =>
        (
          await Promise.all(
            sensitive.map((name) => exists(join(dataRoot, name))),
          )
        ).some(Boolean),
      {
        timeout: 15_000,
        message:
          "Uninstall must remove conversation, role, backup and key data",
      },
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (
          await Promise.all(
            [version, upgradeVersion].map((value) =>
              exists(join(installRoot, `app-${value}`, "Qiban.exe")),
            ),
          )
        ).some(Boolean),
      {
        timeout: 15_000,
        message: "Uninstaller must remove installed application versions",
      },
    )
    .toBe(false);
  if (await exists(dataRoot)) {
    const remaining = await readdir(dataRoot);
    console.log(
      JSON.stringify({
        uninstall_residual_directory: true,
        entries: remaining.slice(0, 16),
        entry_count: remaining.length,
      }),
    );
  }
  console.log(
    "PASS uninstall: installed executable, synthetic conversations/images, roles and encrypted connection data removed.",
  );
  console.log(
    "LIMIT Chinese IME, ordinary-user installation and manual SmartScreen interaction remain unverified.",
  );
} finally {
  await close();
  if (installed && (await exists(join(installRoot, "Update.exe")))) {
    await command(join(installRoot, "Update.exe"), [
      "--uninstall",
      "--silent",
    ]).catch(() =>
      console.log("LIMIT cleanup failed; disposable runner will be destroyed."),
    );
  }
  await rm(upgradeDirectory, { recursive: true, force: true });
}
