// Real renderer regression: keyboard continuation without stealing focus.
// QIBAN_UI_URL can point to an already running base build to demonstrate failure.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";

const url = process.env.QIBAN_UI_URL ?? "http://127.0.0.1:3113";
const server = process.env.QIBAN_UI_URL ? undefined : spawn(
  process.execPath, ["dist/server/index.js"], {
    env: { ...process.env, NODE_ENV: "production", QIBAN_MODE: "demo", HOST: "127.0.0.1", PORT: "3113" },
    stdio: "ignore",
  },
);
let browser;
async function scenario(name, exercise) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let pending;
  await page.route("**/api/chat", (route) => { pending = route; });
  try {
    await page.goto(url);
    const input = page.getByRole("textbox", { name: /发消息/ });
    await expect(input).toBeEnabled();
    async function begin(kind = "keyboard") {
      await input.fill("合成焦点测试");
      if (kind === "keyboard") await input.press("Enter");
      else await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(page.getByText("正在等待回复…", { exact: false })).toBeVisible();
    }
    async function finish() {
      if (!pending) throw new Error("No pending synthetic request");
      await pending.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ content: "合成回复", mode: "demo" }),
      });
      await expect(input).toBeEnabled();
    }
    await exercise({ page, input, begin, finish });
    expect(errors).toEqual([]);
    console.log(`PASS ${name}`);
  } finally { await context.close(); }
}
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${url}/api/config`)).ok) break; } catch {}
    if (attempt === 39) throw new Error("Demo renderer did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  await scenario("keyboard send restores composer after it is enabled", async ({ input, begin, finish }) => {
    await begin(); await finish(); await expect(input).toBeFocused();
  });
  await scenario("send-button click restores composer", async ({ input, begin, finish }) => {
    await begin("pointer"); await finish(); await expect(input).toBeFocused();
  });
  await scenario("Tab navigation during a request retains the user's focus", async ({ page, input, begin, finish }) => {
    await begin(); await page.keyboard.press("Tab");
    const focused = await page.evaluateHandle(() => document.activeElement);
    await finish();
    expect(await page.evaluate((element) => document.activeElement === element, focused)).toBe(true);
    await expect(input).not.toBeFocused();
  });
  await scenario("pointer interaction outside the composer prevents restoration", async ({ page, input, begin, finish }) => {
    await begin(); await page.getByText("演示模式", { exact: true }).click();
    await finish(); await expect(input).not.toBeFocused();
  });
  await scenario("character switch cancels restoration and ignores a late reply", async ({ page, input, begin, finish }) => {
    await begin();
    const companion = page.getByRole("button", { name: "豆包", exact: true });
    await companion.click();
    await finish().catch(() => {});
    await expect(companion).toBeFocused();
    await expect(page.getByText("合成回复", { exact: true })).toHaveCount(0);
    await expect(input).not.toBeFocused();
  });
  await scenario("IME Enter and Shift+Enter retain their existing behavior", async ({ page, input, finish }) => {
    await input.fill("合成输入法测试");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await expect(page.locator(".message.user")).toHaveCount(0);
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("合成输入法测试\n");
    await input.press("Enter");
    await expect(page.getByText("正在等待回复…", { exact: false })).toBeVisible();
    await finish(); await expect(input).toBeFocused();
  });
} finally { await browser?.close(); server?.kill("SIGTERM"); }
