// Browser fixture only. Native dialog/network are represented by synthetic results.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundle = await build({
  stdin: {
    contents: `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { AndroidConnectionPanel } from "./src/android/AndroidConnectionPanel.tsx";
  window.modes=[];
  createRoot(document.getElementById("root")).render(<AndroidConnectionPanel
    onChanged={mode=>window.modes.push(mode)} onDeleteData={async()=>{}}/>);
`,
    loader: "tsx",
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
});
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/bundle.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/bundle.js"
      ? bundle.outputFiles[0].text
      : '<!doctype html><html lang="zh-CN"><div id="root"></div><script src="/bundle.js"></script></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    remote = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    remote.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => {
    let state = {
      mode: "demo",
      baseUrl: "https://api.deepseek.com",
      model: "",
      models: [],
      hasKey: false,
      remembered: false,
      needsSelection: false,
    };
    const result = () => ({ ok: true, value: structuredClone(state) });
    window.calls = { connect: [], selectModel: [], demo: 0 };
    window.qibanAndroid = {
      status: async () => result(),
      connect: async (input) => {
        window.calls.connect.push(input);
        const url = new URL(input.baseUrl);
        url.pathname = url.pathname
          .replace(/\/chat\/completions\/?$/, "")
          .replace(/\/$/, "");
        state = {
          ...state,
          baseUrl: url.href.replace(/\/$/, ""),
          models: ["chat-alpha", "chat-beta"],
          hasKey: true,
          remembered: input.remember,
          needsSelection: !state.model,
        };
        return result();
      },
      selectModel: async ({ model }) => {
        window.calls.selectModel.push(model);
        state = { ...state, model, mode: "live", needsSelection: false };
        return result();
      },
      demo: async () => {
        window.calls.demo++;
        state.mode = "demo";
        return result();
      },
    };
  });
  await page.goto(origin);
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole("button", { name: "先用演示聊天" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  assert.equal((await page.evaluate(() => window.calls)).connect.length, 0);
  await page.getByRole("button", { name: "连接与数据", exact: true }).click();
  await page
    .locator("#android-api-url")
    .fill("https://models.example.invalid/v1/chat/completions");
  await page.getByRole("button", { name: "确认连接与模型" }).click();
  await expect(page.locator("#android-api-url")).toHaveValue(
    "https://models.example.invalid/v1",
  );
  await page.locator("#android-model-choice").selectOption("chat-beta");
  await page.getByRole("button", { name: "确认连接与模型" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  let calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls.connect, [
    {
      baseUrl: "https://models.example.invalid/v1/chat/completions",
      remember: false,
      promptForKey: true,
    },
  ]);
  assert.deepEqual(calls.selectModel, ["chat-beta"]);
  await page.getByRole("button", { name: "连接与数据", exact: true }).click();
  await page.locator("#android-model-choice").selectOption("chat-alpha");
  await page.getByRole("checkbox", { name: "更换当前密钥" }).check();
  await page.getByRole("button", { name: "确认连接与模型" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  calls = await page.evaluate(() => window.calls);
  assert.equal(calls.connect.length, 2);
  assert.equal(calls.connect[1].promptForKey, true);
  assert.deepEqual(calls.selectModel, ["chat-beta", "chat-alpha"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log(
    "PASS Android demo, native-key handoff, canonical endpoint, model edit after key replacement; no renderer key input or remote requests",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
