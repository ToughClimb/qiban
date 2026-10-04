import { _electron, expect } from "@playwright/test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "qiban-native-smoke-"));
let application;
const errors = [];
async function launch() {
  application = await _electron.launch({
    ...(process.env.QIBAN_PACKAGED_EXE
      ? { executablePath: process.env.QIBAN_PACKAGED_EXE, args: [] }
      : {
          args: [
            ...(process.platform === "linux" ? ["--no-sandbox"] : []),
            ".",
          ],
        }),
    env: {
      ...process.env,
      QIBAN_TEST_USER_DATA: directory,
      ...(process.env.QIBAN_PACKAGED_EXE ? { APPDATA: directory } : {}),
      XDG_CACHE_HOME: join(directory, "cache"),
    },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("heading", { name: "林野", exact: true }),
  ).toBeVisible();
  return page;
}
try {
  let page = await launch();
  await page.getByRole("button", { name: "先用演示聊天" }).click();
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  for (const [key, value] of Object.entries({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
  }))
    expect(preferences[key]).toBe(value);
  expect(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
    })),
  ).toEqual({ require: "undefined", process: "undefined" });
  expect(await page.evaluate(() => Object.keys(window.qiban))).not.toContain(
    "invoke",
  );
  const cspBlocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com");
      return false;
    } catch {
      return true;
    }
  });
  expect(cspBlocked).toBe(true);
  await page
    .getByRole("textbox", { name: /发消息/ })
    .fill("native history fixture");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message.assistant .bubble")).toHaveCount(2);
  await page.getByRole("button", { name: /豆包/ }).click();
  await expect(
    page.getByText("native history fixture", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /林野/ }).click();
  await expect(
    page.getByText("native history fixture", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(async () => {
    const result = await window.qiban.loadHistory();
    return result.ok && result.value.lin?.length === 2;
  });
  expect(saved).toBe(true);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/native-desktop.png" });
  await application.close();
  application = undefined;
  page = await launch();
  await expect(
    page.getByText("native history fixture", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /清空聊天/ }).click();
  await expect(
    page.getByText("native history fixture", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "管理角色" }).click();
  await page.getByRole("button", { name: "写一个新角色" }).click();
  await page
    .getByLabel("角色名字", { exact: true })
    .fill("Native custom fixture");
  await page
    .getByLabel("性格与说话方式", { exact: true })
    .fill("gentle fixture");
  await page
    .getByLabel("开场白", { exact: true })
    .fill("Native opening {{user}}");
  await page.getByRole("button", { name: "检查并预览" }).click();
  await expect(
    page.getByRole("button", { name: "确认保存角色" }),
  ).toBeDisabled();
  await page.getByLabel("我已检查设定和不支持的内容").check();
  await page.getByRole("button", { name: "确认保存角色" }).click();
  await expect(
    page.getByRole("heading", { name: "Native custom fixture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Native opening {{user}}", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: /发消息/ })
    .fill("custom history fixture");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".message.assistant .bubble")).toHaveCount(2);
  await page.getByRole("button", { name: "管理角色" }).click();
  await page
    .getByRole("button", { name: "编辑 Native custom fixture" })
    .click();
  await page
    .getByLabel("性格与说话方式", { exact: true })
    .fill("updated fixture");
  await page.getByRole("button", { name: "检查并预览" }).click();
  await page.getByLabel("我已检查设定和不支持的内容").check();
  await page.getByRole("button", { name: "确认保存角色" }).click();
  await expect(
    page.getByText("custom history fixture", { exact: true }),
  ).toBeVisible();
  const dataPath = await application.evaluate(({ app }) =>
    app.getPath("userData"),
  );
  const connection = await page.evaluate(() => window.qiban.status());
  expect(connection.ok && connection.value.hasKey).toBe(false);
  const fixturePath = join(directory, "import-fixture.json");
  const fixtureSource = JSON.stringify({
    name: "Import fixture",
    description: "original fixture",
    first_mes: "import opening",
    system_prompt: "ignored fixture",
  });
  await writeFile(fixturePath, fixtureSource);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, fixturePath);
  await page.getByRole("button", { name: "管理角色" }).click();
  await page.getByRole("button", { name: "导入 JSON 角色" }).click();
  await expect(
    page.getByText("这些内容不会生效，但会保留在导出的原始 JSON 中："),
  ).toBeVisible();
  const before = await page.evaluate(async () => {
    const r = await window.qiban.cards();
    return r.ok ? r.value.characters.length : 0;
  });
  expect(before).toBe(5);
  await page.getByLabel("我已检查设定和不支持的内容").check();
  await page.getByRole("button", { name: "确认保存角色" }).click();
  await expect(
    page.getByRole("heading", { name: "Import fixture", exact: true }),
  ).toBeVisible();
  const exportPath = join(directory, "export-fixture.json");
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.getByRole("button", { name: "管理角色" }).click();
  await page.getByRole("button", { name: "导出原始 JSON" }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(exportPath, "utf8");
      } catch {
        return "";
      }
    })
    .toBe(fixtureSource);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除这个角色" }).click();
  await expect(
    page.getByRole("heading", { name: "林野", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭角色管理" }).click();
  const untrusted = await application.evaluate(
    async ({ BrowserWindow, app }) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: app.getAppPath() + "/desktop-build/preload.cjs",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await win.loadURL("qiban://app/index.html");
      const result = await win.webContents.executeJavaScript(
        "window.qiban.status()",
      );
      win.destroy();
      return result;
    },
  );
  expect(untrusted.ok).toBe(false);
  if (process.platform === "win32") {
    const crypto = await application.evaluate(({ safeStorage }) => {
      const key = "synthetic-dpapi-fixture";
      const encrypted = safeStorage.encryptString(key);
      return {
        available: safeStorage.isEncryptionAvailable(),
        roundtrip: safeStorage.decryptString(encrypted) === key,
        plaintext: encrypted.includes(Buffer.from(key)),
      };
    });
    expect(crypto).toEqual({
      available: true,
      roundtrip: true,
      plaintext: false,
    });
    console.log("PASS real Windows safeStorage/DPAPI synthetic-key round trip");
  }
  expect(errors).toEqual([]);
  console.log(
    `PASS ${process.platform} Electron: offline onboarding, demo chat, isolation/reset/restart, card create/edit/import/export/delete, untrusted-window IPC denial, sandbox, no renderer Node, CSP; zero page errors`,
  );
} finally {
  await application?.close();
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 250,
  });
}
