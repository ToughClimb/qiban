import { _electron, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = await mkdtemp(join(tmpdir(), "qiban-image-smoke-"));
let application;
const errors = [];
async function launch() {
  application = await _electron.launch({
    ...(process.env.QIBAN_PACKAGED_EXE ? { executablePath: process.env.QIBAN_PACKAGED_EXE } : {}),
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), ...(process.env.QIBAN_PACKAGED_EXE ? [] : ["."])],
    env: { ...process.env, QIBAN_TEST_USER_DATA: directory, APPDATA: directory, XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: join(directory, "cache") },
  });
  const page = await application.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "林野", exact: true })).toBeVisible();
  return page;
}
async function picker(path, canceled = false) {
  await application.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: fixture.canceled, filePaths: fixture.canceled ? [] : [fixture.path] }); }, { path, canceled });
}
const references = image => ({ id: image.id, role: "user", content: "", image });
try {
  let page = await launch();
  const dataPath = await application.evaluate(({ app }) => app.getPath("userData"));
  const fixtures = await page.evaluate(() => ["png", "jpeg", "webp"].map((format, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 2048; canvas.height = 1024;
    const context = canvas.getContext("2d"); context.fillStyle = ["#405080", "#905040", "#509040"][index]; context.fillRect(0, 0, canvas.width, canvas.height);
    return { format, base64: canvas.toDataURL(`image/${format}`).split(",")[1] };
  }));
  let first;
  for (const fixture of fixtures) {
    const file = join(directory, `source.${fixture.format}`); await writeFile(file, Buffer.from(fixture.base64, "base64")); await picker(file);
    const picked = await page.evaluate(() => window.qiban.pickChatImage("lin")); expect(picked.ok, JSON.stringify(picked)).toBe(true);
    const draft = picked.value;
    expect(draft.image.mimeType).toBe("image/png"); expect(draft.image.width).toBe(1600); expect(draft.image.height).toBe(800); expect(draft.image.byteLength).toBeLessThanOrEqual(1024 * 1024);
    expect(await page.evaluate(async url => { const image = new Image(); image.src = url; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, draft.previewUrl)).toEqual([1600, 800]);
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    if (first) expect((await page.evaluate(id => window.qiban.chatImagePreview("lin", id), first.image.id)).value).toBe(null);
    first = draft;
  }
  // Dense RGB noise exercises the actual 1 MiB adaptive downsampling path.
  const noisy = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 900;
    const context = canvas.getContext("2d"), data = context.createImageData(canvas.width, canvas.height);
    let seed = 17;
    for (let i = 0; i < data.data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data.data[i] = i % 4 === 3 ? 255 : seed >>> 24; }
    context.putImageData(data, 0, 0); return canvas.toDataURL("image/png").split(",")[1];
  });
  const noisyFile = join(directory, "noise.png"); await writeFile(noisyFile, Buffer.from(noisy, "base64")); await picker(noisyFile);
  const noisyDraft = await page.evaluate(() => window.qiban.pickChatImage("lin")); expect(noisyDraft.ok, JSON.stringify(noisyDraft)).toBe(true);
  expect(noisyDraft.value.image.byteLength).toBeLessThanOrEqual(1024 * 1024); expect(noisyDraft.value.image.width).toBeLessThan(1600);
  await page.evaluate(image => window.qiban.discardChatImage("lin", image.id), noisyDraft.value.image);
  await picker(null, true); expect(await page.evaluate(() => window.qiban.pickChatImage("lin"))).toEqual({ ok: true, value: null });
  const invalid = join(directory, "invalid.png"); await writeFile(invalid, "<svg/>"); await picker(invalid);
  expect((await page.evaluate(() => window.qiban.pickChatImage("lin"))).ok).toBe(false);
  expect((await page.evaluate(() => window.qiban.pickChatImage("../outside"))).ok).toBe(false);
  await picker(join(directory, "source.png"));
  const lin = (await page.evaluate(() => window.qiban.pickChatImage("lin"))).value;
  const saved = { lin: [references(lin.image)] };
  expect((await page.evaluate(history => window.qiban.saveHistory(history), saved)).ok).toBe(true);
  expect((await page.evaluate(id => window.qiban.chatImagePreview("moon", id), lin.image.id)).value).toBe(null);
  expect((await page.evaluate(id => window.qiban.chatImagePreview("lin", id), "https://example.com/image.png")).ok).toBe(false);
  const demo = await page.evaluate(image => window.qiban.chat({ characterId: "lin", messages: [{ role: "user", content: "", image }] }, "synthetic-demo"), lin.image);
  expect(demo.ok).toBe(false); expect(demo.error).toContain("图片聊天");
  const moon = (await page.evaluate(() => window.qiban.pickChatImage("moon"))).value;
  const both = { ...saved, moon: [references(moon.image)] }; await page.evaluate(history => window.qiban.saveHistory(history), both);
  expect((await readFile(join(dataPath, "history.json"), "utf8"))).not.toContain("base64");
  await application.close(); application = undefined; page = await launch();
  expect((await page.evaluate(() => window.qiban.loadHistory())).value).toEqual(both);
  expect((await page.evaluate(id => window.qiban.chatImagePreview("lin", id), lin.image.id)).value).toBe(lin.previewUrl);
  await page.evaluate(history => window.qiban.saveHistory(history), { moon: both.moon });
  expect((await page.evaluate(id => window.qiban.chatImagePreview("lin", id), lin.image.id)).value).toBe(null);
  expect((await page.evaluate(id => window.qiban.chatImagePreview("moon", id), moon.image.id)).value).toBe(moon.previewUrl);
  const customId = await page.evaluate(async () => {
    const preview = await window.qiban.previewCard("new", { name: "Image fixture", description: "fixture", personality: "fixture", scenario: "", firstMessage: "hello", exampleDialogue: "" });
    if (!preview.ok) throw Error(preview.error);
    const saved = await window.qiban.saveCard(preview.value.token, true);
    if (!saved.ok) throw Error(saved.error); return saved.value;
  });
  await picker(join(directory, "source.png"));
  const custom = (await page.evaluate(id => window.qiban.pickChatImage(id), customId)).value;
  await page.evaluate(history => window.qiban.saveHistory(history), { moon: both.moon, [customId]: [references(custom.image)] });
  expect((await page.evaluate(id => window.qiban.deleteCard(id), customId)).ok).toBe(true);
  await expect(readFile(join(dataPath, "chat-images", customId, `${custom.image.id}.png`))).rejects.toThrow();
  expect((await page.evaluate(id => window.qiban.chatImagePreview("moon", id), moon.image.id)).value).toBe(moon.previewUrl);
  // Two open pickers finish out of order; only the latest selection survives.
  await application.evaluate(({ dialog }) => {
    globalThis.imagePickers = [];
    dialog.showOpenDialog = () => new Promise(resolve => { globalThis.imagePickers.push(resolve); });
  });
  const oldPick = page.evaluate(() => window.qiban.pickChatImage("lin"));
  await expect.poll(() => application.evaluate(() => globalThis.imagePickers.length)).toBe(1);
  const latestPick = page.evaluate(() => window.qiban.pickChatImage("moon"));
  await expect.poll(() => application.evaluate(() => globalThis.imagePickers.length)).toBe(2);
  await application.evaluate((_electron, path) => globalThis.imagePickers[1]({ canceled: false, filePaths: [path] }), join(directory, "source.png"));
  expect((await latestPick).ok).toBe(true);
  await application.evaluate((_electron, path) => globalThis.imagePickers[0]({ canceled: false, filePaths: [path] }), join(directory, "source.png"));
  expect(await oldPick).toEqual({ ok: true, value: null });
  // Native dialog races: clear-all invalidates a picker that returns afterward.
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => new Promise(resolve => { globalThis.finishImagePicker = resolve; });
  });
  const pending = page.evaluate(() => window.qiban.pickChatImage("lin"));
  await expect.poll(() => application.evaluate(() => typeof globalThis.finishImagePicker)).toBe("function");
  await page.evaluate(() => window.qiban.deleteData());
  await application.evaluate((_electron, path) => globalThis.finishImagePicker({ canceled: false, filePaths: [path] }), join(directory, "source.png"));
  expect(await pending).toEqual({ ok: true, value: null });
  await expect(readdir(join(dataPath, "chat-images"))).rejects.toThrow();
  expect(errors).toEqual([]);
  console.log(`PASS ${process.platform} ${process.env.QIBAN_PACKAGED_EXE ? "packaged ASAR" : "development"} image bridge: real PNG/JPEG/WebP decode, 1600 edge and 1 MiB normalization, local previews, cancel/replacement/discard, owner isolation, image-only restart/history, scoped reset/card deletion, out-of-order pickers and late dialog/all-data cleanup; no paid calls`);
} finally { await application?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
