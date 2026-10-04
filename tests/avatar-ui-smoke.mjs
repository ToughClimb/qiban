// Renderer-only avatar contract checks; picker/storage are synthetic, never filesystem I/O.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { characters } from "../shared/characters.ts";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGN0jPVlYGBgYmBgYGBgAAALIgDvsqi9WwAAAABJRU5ErkJggg==";
const url = "http://127.0.0.1:3114";
const server = spawn(process.execPath, ["dist/server/index.js"], {
  env: { ...process.env, NODE_ENV: "production", QIBAN_MODE: "demo", HOST: "127.0.0.1", PORT: "3114" },
  stdio: "ignore",
});
let browser;
async function scenario(name, options, exercise) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], remote = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === url) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(({ characters, image, options }) => {
    let list = characters.map((item, index) => index === 0 && options.initial
      ? { ...item, avatarUrl: options.initial } : { ...item });
    const ok = (value) => ({ ok: true, value });
    window.avatarCalls = { imported: [], reset: [], reloads: 0 };
    window.qiban = {
      status: async () => ok({ mode: "demo", baseUrl: "https://api.deepseek.com", model: "", models: [], hasKey: false, remembered: false, needsSelection: false }),
      dataPath: async () => ok("synthetic fixture"),
      cards: async () => { window.avatarCalls.reloads++; return ok({ characters: structuredClone(list), issues: [] }); },
      loadHistory: async () => ok({}), saveHistory: async () => ok(),
      cancelCard: async () => ok(),
      ...(options.support === false ? {} : {
        importAvatar: async (id) => {
          window.avatarCalls.imported.push(id);
          if (options.action === "error") return { ok: false, error: "合成头像导入错误" };
          if (options.action === "cancel") return ok(null);
          list = list.map((item) => item.id === id ? { ...item, avatarUrl: image } : item);
          return ok(image);
        },
        deleteAvatar: async (id) => {
          window.avatarCalls.reset.push(id);
          list = list.map((item) => { const { avatarUrl, ...rest } = item; return item.id === id ? rest : item; });
          return ok();
        },
      }),
    };
    localStorage.setItem("qiban.onboarded.v1", "yes");
  }, { characters, image, options });
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "管理角色" }).click();
    await expect(page.locator(".card-dialog[open]")).toBeVisible();
    await exercise(page);
    expect(errors).toEqual([]); expect(remote).toEqual([]);
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
  await scenario("unsupported platform hides avatar controls", { support: false }, async (page) => {
    await expect(page.getByRole("button", { name: "更换林野的头像" })).toHaveCount(0);
  });
  await scenario("picker cancellation does not reload or report an error", { action: "cancel" }, async (page) => {
    const reloads = await page.evaluate(() => window.avatarCalls.reloads);
    const change = page.getByRole("button", { name: "更换林野的头像" });
    await change.click(); await expect(change).toBeEnabled();
    expect(await page.evaluate(() => window.avatarCalls.imported)).toEqual(["lin"]);
    expect(await page.evaluate(() => window.avatarCalls.reloads)).toBe(reloads);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
  await scenario("import refreshes portraits and reset restores built-in art", {}, async (page) => {
    await page.getByRole("button", { name: "更换林野的头像" }).click();
    const portrait = page.locator('.character-card[aria-pressed="true"] img');
    await expect(portrait).toHaveAttribute("src", image);
    expect(await portrait.evaluate((node) => node.naturalWidth)).toBe(2);
    await expect(page.locator(".avatar-editor img")).toHaveAttribute("src", image);
    await page.getByRole("button", { name: "恢复默认" }).click();
    await expect(portrait).toHaveAttribute("src", /characters\/lin\.svg$/);
    expect(await page.evaluate(() => window.avatarCalls.reset)).toEqual(["lin"]);
  });
  await scenario("safe bridge error is visible", { action: "error" }, async (page) => {
    await page.getByRole("button", { name: "更换林野的头像" }).click();
    await expect(page.getByRole("alert")).toHaveText("合成头像导入错误");
  });
  for (const [name, initial] of [
    ["broken image falls back", "data:image/png;base64,bm90LWFuLWltYWdl"],
    ["remote image is never requested", "https://avatars.example.invalid/photo.png"],
    ["another character's native URL is rejected", `qiban://app/avatars/tao/${"a".repeat(64)}.png`],
  ]) await scenario(name, { initial }, async (page) => {
    await expect(page.locator('.character-card[aria-pressed="true"] img')).toHaveAttribute("src", /characters\/lin\.svg$/);
  });
} finally { await browser?.close(); server.kill("SIGTERM"); }
