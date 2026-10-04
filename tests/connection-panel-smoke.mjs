// Browser-only regression smoke. All service calls use a synthetic in-memory bridge.
// Run: node tests/connection-panel-smoke.mjs
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
      import { ConnectionPanel } from "./src/ConnectionPanel.tsx";
      window.changedModes = [];
      createRoot(document.getElementById("root")).render(
        <ConnectionPanel onChanged={(mode) => window.changedModes.push(mode)}
          onDeleteData={async () => {}} />
      );
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
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text :
    '<!doctype html><html lang="zh-CN"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const failures = [];

async function scenario(name, initial, exercise) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const remoteRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    remoteRequests.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript(({ initial }) => {
    const canonical = (input) => {
      const url = new URL(input);
      url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") + "/";
      return url.href.replace(/\/$/, "");
    };
    let state = {
      mode: "demo", baseUrl: "https://api.deepseek.com", model: "",
      models: [], hasKey: false, remembered: false, needsSelection: false,
      ...initial,
    };
    const result = () => ({ ok: true, value: structuredClone(state) });
    window.bridgeCalls = { connect: [], selectModel: [] };
    window.qiban = {
      status: async () => result(),
      dataPath: async () => ({ ok: true, value: "synthetic app-owned data location" }),
      connect: async (input) => {
        window.bridgeCalls.connect.push({ ...input });
        const baseUrl = canonical(input.baseUrl);
        if (!input.apiKey && (!state.hasKey || baseUrl !== state.baseUrl))
          return { ok: false, error: "Synthetic fixture requires a new key." };
        const models = initial.models ?? ["chat-alpha", "chat-beta"];
        // Match DesktopService: rediscovery preserves a valid prior selection.
        const previous = baseUrl === state.baseUrl && state.model &&
          (!models.length || models.includes(state.model)) ? state.model : "";
        const model = previous || (models.length === 1 ? models[0] : "");
        state = { ...state, baseUrl, model, models, hasKey: true,
          remembered: input.remember, needsSelection: !model, mode: model ? "live" : "demo" };
        return result();
      },
      selectModel: async (model) => {
        window.bridgeCalls.selectModel.push(model);
        if (!state.hasKey || !model || (state.models.length && !state.models.includes(model)))
          return { ok: false, error: "Synthetic fixture rejected the model." };
        state = { ...state, model, mode: "live", needsSelection: false };
        return result();
      },
      demo: async () => { state = { ...state, mode: "demo" }; return result(); },
      deleteKey: async () => {
        state = { ...state, mode: "demo", hasKey: false, needsSelection: false };
        return result();
      },
      diagnostics: async () => ({ ok: true, value: {} }),
    };
  }, { initial });
  try {
    await page.goto(origin);
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(page.locator("#api-url")).toHaveValue(initial.baseUrl ?? "https://api.deepseek.com");
    await exercise(page);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(remoteRequests, []);
    console.log(`PASS ${name}`);
  } catch (error) {
    const calls = await page.evaluate(() => window.bridgeCalls).catch(() => ({}));
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}\nBridge calls: ${JSON.stringify(calls)}`);
  } finally {
    await context.close();
  }
}
const configured = {
  baseUrl: "https://models.example.invalid/v1", hasKey: true,
  model: "chat-alpha", models: ["chat-alpha", "chat-beta"], mode: "live",
};
async function chosen(page, expected, connects) {
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 1500 });
  const calls = await page.evaluate(() => window.bridgeCalls);
  assert.equal(calls.connect.length, connects);
  assert.deepEqual(calls.selectModel, [expected]);
  assert.equal((await page.evaluate(() => window.qiban.status())).value.model, expected);
  assert.equal((await page.evaluate(() => window.changedModes)).at(-1), "live");
}
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const suffix of ["/v1/chat/completions", "/v1/"]) {
    await scenario(`first connection with ${suffix}`, {}, async (page) => {
      await page.locator("#api-url").fill(`https://models.example.invalid${suffix}`);
      await page.locator("#api-key").fill("synthetic-browser-fixture-key");
      await page.getByRole("button", { name: "连接并开始聊天" }).click();
      await expect(page.locator("#model-choice")).toBeVisible();
      await page.locator("#model-choice").selectOption("chat-beta");
      await page.getByRole("button", { name: "使用这个模型" }).click();
      await chosen(page, "chat-beta", 1);
      await page.getByRole("button", { name: "连接与数据" }).click();
      await expect(page.locator("#api-url")).toHaveValue(configured.baseUrl);
      await expect(page.locator("#model-choice")).toHaveValue("chat-beta");
    });
  }
  await scenario("configured model remains editable without rediscovery", configured, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").selectOption("chat-beta");
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-beta", 0);
  });
  await scenario("configured manual model typo can be corrected", { ...configured, models: [], model: "chat-aplha" }, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").fill("chat-alpha");
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-alpha", 0);
  });
  await scenario("new key preserves a newly selected model", configured, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").selectOption("chat-beta");
    await page.locator("#api-key").fill("synthetic-browser-fixture-replacement-key");
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-beta", 1);
  });
  await scenario("new key preserves correction of a manual typo", { ...configured, models: [], model: "chat-aplha" }, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").fill("chat-alpha");
    await page.locator("#api-key").fill("synthetic-browser-fixture-replacement-key");
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-alpha", 1);
  });
  await scenario("remember preference is saved without losing the edited model", configured, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").selectOption("chat-beta");
    await page.getByRole("checkbox", { name: "仅在这台电脑记住密钥" }).check();
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-beta", 1);
    assert.equal((await page.evaluate(() => window.qiban.status())).value.remembered, true);
  });
  await scenario("changing service rediscovery does not reuse the old model selection", configured, async (page) => {
    await expect(page.locator("#model-choice")).toBeVisible({ timeout: 1500 });
    await page.locator("#model-choice").selectOption("chat-beta");
    await page.locator("#api-url").fill("https://other.example.invalid/v1/chat/completions");
    await expect(page.locator("#model-choice")).toHaveCount(0);
    await page.locator("#api-key").fill("synthetic-browser-fixture-other-service-key");
    await page.locator("button[type=submit]").click();
    await expect(page.locator("#api-url")).toHaveValue("https://other.example.invalid/v1");
    await expect(page.locator("#model-choice")).toHaveValue("");
    assert.deepEqual((await page.evaluate(() => window.bridgeCalls)).selectModel, []);
    await page.locator("#model-choice").selectOption("chat-alpha");
    await page.locator("button[type=submit]").click();
    await chosen(page, "chat-alpha", 1);
  });
  assert.deepEqual(failures, [], "ConnectionPanel browser regressions");
  console.log("PASS eight mocked browser scenarios; no external requests or page errors");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
