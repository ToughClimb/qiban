// Stable-origin renderer persistence and delete-all-data behavior; native calls are synthetic.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { characters } from "../shared/characters.ts";
import { APPEARANCE_KEY, DEFAULT_ACCENT, accentPalette } from "../src/appearance.ts";

const url = "http://127.0.0.1:3115";
const server = spawn(process.execPath, ["dist/server/index.js"], {
  env: { ...process.env, NODE_ENV: "production", QIBAN_MODE: "demo", HOST: "127.0.0.1", PORT: "3115" }, stdio: "ignore",
});
let browser;
async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  await context.addInitScript(({ characters }) => {
    const ok = (value) => ({ ok: true, value });
    window.qiban = {
      status: async () => ok({ mode: "demo", baseUrl: "https://api.deepseek.com", model: "", models: [], hasKey: false, remembered: false, needsSelection: false }),
      dataPath: async () => ok("synthetic fixture"), cards: async () => ok({ characters, issues: [] }),
      loadHistory: async () => ok({}), saveHistory: async () => ok(),
      deleteData: async () => sessionStorage.getItem("synthetic-wipe-fails")
        ? { ok: false, error: "合成删除错误" } : ok(),
    };
    localStorage.setItem("qiban.onboarded.v1", "yes");
  }, { characters });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  return { context, page, errors };
}
async function appearance(page) {
  await page.getByRole("button", { name: "连接与数据" }).click();
  await page.locator(".appearance-options > summary").click();
}
async function expectAccent(page, color) {
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe(accentPalette(color)["--accent"]);
}
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${url}/api/config`)).ok) break; } catch {}
    if (attempt === 39) throw new Error("Demo renderer did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const first = await open();
  await appearance(first.page);
  const blue = first.page.getByRole("button", { name: "雾蓝主题色" });
  await blue.focus(); await first.page.keyboard.press("Enter");
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expectAccent(first.page, "#46618a");
  await first.page.reload(); await expectAccent(first.page, "#46618a");
  const storageState = await first.context.storageState();
  expect(first.errors).toEqual([]); await first.context.close();
  const reopened = await open({ storageState });
  await expectAccent(reopened.page, "#46618a");
  await appearance(reopened.page);
  await reopened.page.getByLabel("自选主题色").fill("#ffff00");
  await expectAccent(reopened.page, "#ffff00");
  expect(JSON.parse(await reopened.page.evaluate((key) => localStorage.getItem(key), APPEARANCE_KEY)).accent).toBe("#ffff00");
  if (await reopened.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Mobile overflow");
  console.log("PASS preset keyboard selection, native picker, reload and reopened-renderer persistence");
  await reopened.page.evaluate(() => sessionStorage.setItem("synthetic-wipe-fails", "yes"));
  await reopened.page.locator(".connection-dialog .local-data > summary").click();
  reopened.page.once("dialog", (dialog) => dialog.accept());
  await reopened.page.getByRole("button", { name: "删除所有本地数据" }).click();
  await expect(reopened.page.getByRole("alert")).toHaveText("合成删除错误");
  await expectAccent(reopened.page, "#ffff00");
  await reopened.page.evaluate(() => sessionStorage.removeItem("synthetic-wipe-fails"));
  reopened.page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    reopened.page.waitForEvent("load"),
    reopened.page.getByRole("button", { name: "删除所有本地数据" }).click(),
  ]);
  expect(await reopened.page.evaluate((key) => localStorage.getItem(key), APPEARANCE_KEY)).toBe(null);
  await expectAccent(reopened.page, DEFAULT_ACCENT);
  expect(reopened.errors).toEqual([]); await reopened.context.close();
  console.log("PASS failed native wipe preserves accent; successful delete-all clears accent before reload");
  const blocked = await open();
  await blocked.page.evaluate(() => { Storage.prototype.setItem = () => { throw Error("blocked"); }; });
  await appearance(blocked.page);
  await blocked.page.getByRole("button", { name: "莓红主题色" }).click();
  await expectAccent(blocked.page, "#915669");
  await expect(blocked.page.getByText("本次有效，暂时无法保存。")).toBeVisible();
  expect(blocked.errors).toEqual([]); await blocked.context.close();
  console.log("PASS unavailable storage remains usable and reports that preference was not saved");
} finally { await browser?.close(); server.kill("SIGTERM"); }
