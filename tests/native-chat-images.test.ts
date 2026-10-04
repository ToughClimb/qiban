import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { ChatImageStore } from "../desktop/chat-images.js";
import { HistoryStore } from "../desktop/history.js";
import { DesktopService } from "../desktop/service.js";
import { ConnectionStore } from "../desktop/store.js";
import type { Conversations } from "../shared/history.js";
import type { ChatImageAttachment } from "../shared/image-chat.js";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSQv4DwAD5gH6hp8d8QAAAABJRU5ErkJggg==", "base64");
function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "qiban-chat-images-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "chosen.png"); writeFileSync(source, png);
  return { directory, source, images: new ChatImageStore(directory) };
}
const message = (image: ChatImageAttachment) => ({ id: image.id, role: "user" as const, content: "", image });
function chunk(kind: string, data: Buffer) {
  const value = Buffer.alloc(data.length + 12);
  value.writeUInt32BE(data.length); value.write(kind, 4); data.copy(value, 8);
  value.writeUInt32BE(crc32(value.subarray(4, -4)), value.length - 4); return value;
}
test("native image ownership, metadata stripping, image-only persistence, scoped reset and startup orphan cleanup", async t => {
  const { directory, source, images } = fixture(t);
  const metadataPng = Buffer.concat([png.subarray(0, 33), chunk("tEXt", Buffer.from("private fixture")), png.subarray(33)]);
  const lin = await images.import("lin", source, async () => metadataPng);
  assert.deepEqual(images.image("lin", lin.image.id), png);
  assert.match(lin.previewUrl, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  const history = new HistoryStore(directory);
  const saved: Conversations = { lin: [message(lin.image)] };
  history.save(saved); images.reconcile(history.load());
  images.discard("lin", lin.image.id); // committed history remains intact
  assert.ok(images.preview("lin", lin.image.id));
  assert.equal(images.preview("moon", lin.image.id), null);
  await assert.rejects(images.resolve(lin.image, "moon"));
  await assert.rejects(images.resolve({ ...lin.image, width: 2 }, "lin"));
  for (const id of ["../chosen.png", source, "https://example.com/image.png"]) assert.throws(() => images.preview("lin", id));
  const moon = await images.import("moon", source, async () => png);
  const both: Conversations = { ...saved, moon: [message(moon.image)] };
  history.save(both); images.reconcile(both, saved);
  const orphan = await images.import("lin", source, async () => png);
  const restored = new ChatImageStore(directory); restored.reconcile(history.load());
  assert.equal(restored.preview("lin", orphan.image.id), null);
  assert.ok(restored.preview("lin", lin.image.id));
  assert.ok(!readFileSync(join(directory, "history.json"), "utf8").includes("base64"));
  const reset = { moon: both.moon }; history.save(reset); restored.reconcile(reset, both);
  assert.equal(restored.preview("lin", lin.image.id), null);
  assert.ok(restored.preview("moon", moon.image.id));
  restored.deleteCharacter("lin"); assert.ok(restored.preview("moon", moon.image.id));
  restored.clear(); assert.equal(existsSync(restored.directory), false);
});
test("replacement, discard and owner reset/delete/all-data prevent late decoder resurrection", async t => {
  const { source, images } = fixture(t);
  const first = await images.import("lin", source, async () => png);
  const second = await images.import("lin", source, async () => png);
  assert.equal(images.preview("lin", first.image.id), null);
  images.discard("lin", first.image.id); assert.ok(images.preview("lin", second.image.id));
  images.discard("lin", second.image.id); assert.equal(images.preview("lin", second.image.id), null);
  for (const invalidate of [() => images.beginSelection("moon"), () => images.deleteCharacter("lin"), () => images.clear(), () => images.reconcile({}, { lin: [{ id: "fixture", role: "user", content: "prior" }] })]) {
    let finish!: (value: Buffer) => void;
    const pending = images.import("lin", source, () => new Promise(resolve => { finish = resolve; }));
    invalidate(); finish(png); await assert.rejects(pending, /取消/);
  }
  const ticket = images.beginSelection("lin"); images.deleteCharacter("lin"); assert.equal(ticket(), false);
});
test("invalid source, oversized/decode output and symlink paths fail before storage", async t => {
  const { directory, source, images } = fixture(t);
  let decodes = 0;
  const decode = async () => { decodes++; return png; };
  for (const [name, bytes] of [["svg.png", Buffer.from("<svg/>")], ["large.png", Buffer.alloc(5 * 1024 * 1024 + 1)], ["animated.png", Buffer.concat([png.subarray(0, 33), chunk("acTL", Buffer.alloc(8)), png.subarray(33)])]] as const) {
    const path = join(directory, name); writeFileSync(path, bytes);
    await assert.rejects(images.import("lin", path, decode));
  }
  assert.equal(decodes, 0);
  await assert.rejects(images.import("lin", source, async () => Buffer.alloc(1024 * 1024 + 1)));
  await assert.rejects(images.import("lin", source, async () => { throw Error("decode"); }));
  if (process.platform !== "win32") {
    const link = join(directory, "link.png"); symlinkSync(source, link);
    await assert.rejects(images.import("lin", link, decode));
    mkdirSync(images.directory); symlinkSync(directory, join(images.directory, "moon"), "dir");
    await assert.rejects(images.import("moon", source, decode));
  }
});
test("desktop explicit Send uses configured synthetic provider, recent three images, omissions and no URLs in history", async t => {
  const { directory, source, images } = fixture(t);
  const attachments: ChatImageAttachment[] = [];
  const history: Conversations = { lin: [] };
  let posts = 0;
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  const service = new DesktopService(store, async (url, key, body) => {
    assert.equal(key, "synthetic-fixture-key");
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    posts++; assert.equal(url.href, "https://configured.example/v1/chat/completions");
    const serialized = JSON.stringify(body);
    assert.equal((serialized.match(/data:image\/png;base64/g) ?? []).length, 3);
    assert.ok(serialized.includes("较早的图片")); assert.ok(!serialized.includes("qiban://"));
    return { choices: [{ message: { content: "fixture response" } }] };
  }, undefined, images.resolve);
  await service.connect({ baseUrl: "https://configured.example/v1", apiKey: "synthetic-fixture-key", remember: false });
  for (let i = 0; i < 4; i++) {
    const draft = await images.import("lin", source, async () => png); attachments.push(draft.image);
    history.lin!.push(message(draft.image));
    if (i < 3) history.lin!.push({ id: `assistant-${i}`, role: "assistant", content: "fixture" });
    images.reconcile(history);
  }
  assert.equal(posts, 0);
  const request = { characterId: "lin", messages: history.lin!.map(({ role, content, image }) => ({ role, content, ...(image ? { image } : {}) })) };
  const reply = await service.chat(request, "synthetic-send");
  assert.deepEqual(reply.omittedImageIds, [attachments[0].id]); assert.equal(posts, 1);
  service.demo(); await assert.rejects(service.chat(request, "demo"), /图片聊天/); assert.equal(posts, 1);
  const unsupported = new DesktopService(store, async (_url, _key, body) => {
    if (body) { posts++; throw Error("Unexpected request"); }
    return { data: [{ id: "text-only-fixture" }] };
  }, undefined, images.resolve);
  await unsupported.connect({ baseUrl: "https://configured.example/v1", apiKey: "synthetic-fixture-key", remember: false });
  await assert.rejects(unsupported.chat(request, "unsupported"), /图片聊天/); assert.equal(posts, 1);
});
test("cancel during trusted resolution returns promptly and sends no provider request", async t => {
  const { directory } = fixture(t);
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let resolve!: () => void; let started!: () => void;
  const ready = new Promise<void>(accept => { started = accept; });
  let posts = 0;
  const image: ChatImageAttachment = { id: "image-00000000-0000-0000-0000-000000000000", mimeType: "image/png", width: 1, height: 1, byteLength: png.length };
  const service = new DesktopService(store, async (_url, _key, body) => { if (body) posts++; return { data: [{ id: "deepseek-flash" }] }; }, undefined, async () => {
    started(); await new Promise<void>(accept => { resolve = accept; }); return { attachment: image, bytes: png };
  });
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  const pending = service.chat({ characterId: "lin", messages: [{ role: "user", content: "", image }] }, "cancel-fixture");
  await ready; service.cancelCharacter("moon"); service.cancelCharacter("lin"); await assert.rejects(pending, /取消/); resolve();
  await new Promise(accept => setImmediate(accept)); assert.equal(posts, 0);
});
test("first Send and retry resolve staged image before history effect; unrelated GC retains it and cross-character forgery never transports", async t => {
  const { directory, source, images } = fixture(t);
  const draft = await images.import("lin", source, async () => png);
  images.reconcile({}, {}); // an older or unrelated renderer history effect
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let posts = 0;
  let resolver = images.resolve;
  const service = new DesktopService(store, async (_url, _key, body) => {
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    posts++; assert.ok(JSON.stringify(body).includes("data:image/png;base64,"));
    return { choices: [{ message: { content: "image-only fixture" } }] };
  }, undefined, (attachment, owner, signal) => resolver(attachment, owner, signal));
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  const request = { characterId: "lin", messages: [{ role: "user" as const, content: "", image: draft.image }] };
  await service.chat(request, "first-send"); await service.chat(request, "retry"); assert.equal(posts, 2);
  await assert.rejects(service.chat({ ...request, characterId: "moon" }, "forged"), /图片/); assert.equal(posts, 2);
  const history = new HistoryStore(directory); history.save({ lin: [message(draft.image)] }); images.reconcile(history.load());
  const restored = new ChatImageStore(directory); restored.reconcile(history.load()); resolver = restored.resolve;
  await service.chat(request, "restored-retry"); assert.equal(posts, 3);
  images.discard("lin", draft.image.id); assert.ok(images.preview("lin", draft.image.id));
  restored.reconcile({}, history.load()); await assert.rejects(service.chat(request, "removed"), /图片/); assert.equal(posts, 3);
});
