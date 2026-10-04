import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const port = 3107;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/server/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    QIBAN_MODE: "demo",
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: "ignore",
});
let browser;
const browserErrors = [];
async function openPage(options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  return { page, context };
}
async function send(page, content) {
  await page.getByRole("textbox", { name: /发消息/ }).fill(content);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".message.user .bubble").last()).toHaveText(
    content,
  );
  await expect(page.getByRole("textbox", { name: /发消息/ })).toBeEnabled();
}
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) break;
    } catch {}
    if (attempt === 39) throw new Error("Production server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const path of ["/.env", "/server/provider.ts", "/package.json"]) {
    const response = await fetch(`${url}${path}`);
    if (response.status !== 404)
      throw new Error(`Production file boundary failed: ${path}`);
  }
  console.log(
    "PASS production file boundary: environment, server source, and package manifest are not served",
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  await mkdir("artifacts", { recursive: true });
  const { page, context } = await openPage({
    viewport: { width: 1280, height: 850 },
  });
  await page.goto(url);
  await expect(page.getByText("演示模式", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
  await send(page, "林野专属的一次散步");
  await expect(page.locator(".message.assistant .bubble")).toHaveCount(2);
  await page.getByRole("button", { name: /豆包/ }).click();
  await expect(
    page.getByText("林野专属的一次散步", { exact: true }),
  ).toHaveCount(0);
  await send(page, "豆包专属的一颗球");
  await page.reload();
  await expect(
    page.getByText("林野专属的一次散步", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /豆包/ }).click();
  await expect(
    page.getByText("豆包专属的一颗球", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "清空聊天" }).click();
  await expect(
    page.getByText("豆包专属的一颗球", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空聊天" }).click();
  await expect(page.locator(".message.user")).toHaveCount(0);
  await page.getByRole("button", { name: /林野/ }).click();
  await expect(
    page.getByText("林野专属的一次散步", { exact: true }),
  ).toBeVisible();
  console.log(
    "PASS desktop: demo label, send, character isolation, reload persistence, reset cancellation and selected-only reset",
  );

  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "SECRET-RAW-ERROR" }),
    }),
  );
  await page.getByRole("textbox", { name: /发消息/ }).fill("测试重试");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("SECRET-RAW-ERROR", { exact: false }),
  ).toHaveCount(0);
  await page.unroute("**/api/chat");
  await page.getByRole("button", { name: "重试回复" }).click();
  await expect(page.getByRole("textbox", { name: /发消息/ })).toBeEnabled();
  await expect(page.getByText("测试重试", { exact: true })).toHaveCount(1);
  console.log(
    "PASS error/retry: safe public error, preserved user message, successful retry without duplicate",
  );

  await page.route("**/api/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ content: "迟到的回复", mode: "demo" }),
      })
      .catch(() => {});
  });
  await page.getByRole("textbox", { name: /发消息/ }).fill("切换时的消息");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("正在等待回复…", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /陶陶/ }).click();
  await expect(page.getByText("切换时的消息", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(page.getByText("迟到的回复", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/chat");
  await page.reload();
  await expect(page.getByRole("button", { name: "重试回复" })).toBeVisible();
  await page.getByRole("button", { name: "重试回复" }).click();
  await expect(page.getByRole("textbox", { name: /发消息/ })).toBeEnabled();
  console.log(
    "PASS cancellation: late replies ignored on character switch; unanswered message recoverable after reload",
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await context.close();

  const mobile = await openPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.page.goto(url);
  await mobile.page.getByRole("button", { name: /月饼/ }).click();
  await send(mobile.page, "想安静待一会儿");
  await expect(mobile.page.locator(".message.assistant .bubble")).toHaveCount(
    2,
  );
  if (
    await mobile.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
  )
    throw new Error("Mobile horizontal overflow");
  await expect(
    mobile.page.getByRole("button", { name: "发送" }),
  ).toBeInViewport();
  await mobile.page.waitForTimeout(400);
  await mobile.page.screenshot({
    path: "artifacts/mobile.png",
    fullPage: true,
  });
  await mobile.context.close();
  console.log(
    "PASS mobile: 390px layout, pet send/reply, visible composer, no horizontal overflow",
  );

  const reconnect = await openPage();
  await reconnect.page.route("**/api/config", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await reconnect.page.goto(url);
  await expect(
    reconnect.page.getByRole("button", { name: "重新连接" }),
  ).toBeVisible();
  await expect(
    reconnect.page.getByRole("button", { name: "发送" }),
  ).toBeDisabled();
  await reconnect.page.unroute("**/api/config");
  await reconnect.page.getByRole("button", { name: "重新连接" }).click();
  await expect(
    reconnect.page.getByText("演示模式", { exact: true }),
  ).toBeVisible();
  await reconnect.context.close();
  console.log(
    "PASS startup failure: disabled send and successful manual reconnect",
  );

  const noStorage = await openPage();
  await noStorage.context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await noStorage.page.goto(url);
  await expect(noStorage.page.getByText(/浏览器无法保存记录/)).toBeVisible();
  await send(noStorage.page, "存储不可用也能聊天");
  await noStorage.context.close();
  console.log("PASS storage failure: visible warning and usable chat");

  const liveUI = await openPage();
  await liveUI.page.route("**/api/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ mode: "live" }),
    }),
  );
  let attempts = 0;
  await liveUI.page.route("**/api/chat", (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      });
    if (route.request().headers().authorization !== "Bearer synthetic-invite")
      throw new Error("Missing invite header");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ content: "测试回复", mode: "live" }),
    });
  });
  await liveUI.page.goto(url);
  await expect(liveUI.page.getByLabel("输入体验口令，开始聊天")).toBeVisible();
  await liveUI.page.getByLabel("输入体验口令，开始聊天").fill("wrong-invite");
  await liveUI.page.getByRole("button", { name: "进入" }).click();
  await liveUI.page.getByRole("textbox", { name: /发消息/ }).fill("合成测试");
  await liveUI.page.getByRole("button", { name: "发送" }).click();
  await expect(liveUI.page.getByRole("alert")).toHaveText(
    "体验口令不正确，请重新输入。",
  );
  await liveUI.page
    .getByLabel("输入体验口令，开始聊天")
    .fill("synthetic-invite");
  await liveUI.page.getByRole("button", { name: "进入" }).click();
  await liveUI.page.getByRole("button", { name: "重试回复" }).click();
  await expect(
    liveUI.page.getByText("测试回复", { exact: true }),
  ).toBeVisible();
  const saved = await liveUI.page.evaluate(() => JSON.stringify(localStorage));
  if (saved.includes("synthetic-invite"))
    throw new Error("Invite token persisted");
  await liveUI.context.close();
  console.log(
    "PASS mocked live UI: access gate, invalid-code recovery, memory-only invite token; no live provider calls",
  );
  if (browserErrors.length)
    throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  console.log("PASS zero browser runtime errors");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
