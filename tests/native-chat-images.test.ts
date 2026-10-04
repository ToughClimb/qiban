import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { ChatImageStore } from "../desktop/chat-images.js";
import { HistoryStore, conversationInterrupted } from "../desktop/history.js";
import { DesktopService } from "../desktop/service.js";
import { ConnectionStore } from "../desktop/store.js";
import type { Conversations } from "../shared/history.js";
import { replaceConversation } from "../shared/history.js";
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
for (const withImage of [true, false]) test(`history rollover 200 -> 199 keeps pending ${withImage ? "image" : "text"} reply and saved image across restart`, async t => {
  const { directory, source, images } = fixture(t);
  const history = new HistoryStore(directory);
  const previous: Conversations = { lin: Array.from({ length: 200 }, (_, index) => ({ id: `old-${index}`, role: index % 2 ? "assistant" as const : "user" as const, content: `fixture ${index}` })) };
  history.save(previous); images.reconcile(previous);
  const draft = withImage ? await images.import("lin", source, async () => png) : undefined;
  const user = { id: "next-user", role: "user" as const, content: draft ? "" : "next fixture", ...(draft ? { image: draft.image } : {}) };
  const next = replaceConversation(previous, "lin", [...previous.lin!, user]);
  assert.equal(next.lin!.length, 199); assert.equal(next.lin![0].id, "old-2");
  assert.equal(conversationInterrupted(previous.lin, next.lin), false);
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let finish!: (value: unknown) => void;
  let entered!: () => void;
  const ready = new Promise<void>(accept => { entered = accept; });
  let signal!: AbortSignal;
  const service = new DesktopService(store, async (_url, _key, body, abort) => {
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    signal = abort!; entered(); return new Promise(resolve => { finish = resolve; });
  }, undefined, images.resolve);
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  const request = { characterId: "lin", messages: next.lin!.map(({ role, content, image }) => ({ role, content, ...(image ? { image } : {}) })) };
  const pending = service.chat(request, "rollover-send"); await ready;
  // Same successful-save hooks used by main IPC, while the reply is pending.
  history.save(next); const saved = history.load(); service.historySaved(previous, saved); images.reconcile(saved, previous);
  assert.equal(signal.aborted, false);
  if (draft) assert.ok(images.preview("lin", draft.image.id));
  finish({ choices: [{ message: { content: "rollover reply" } }] });
  const reply = await pending; assert.equal(reply.content, "rollover reply");
  const complete = replaceConversation(saved, "lin", [...saved.lin!, { id: "next-assistant", role: "assistant", content: reply.content }]);
  history.save(complete); images.reconcile(complete, saved);
  const restarted = new ChatImageStore(directory); restarted.reconcile(history.load());
  assert.equal(history.load().lin!.length, 200);
  if (draft) {
    assert.equal(history.load().lin!.at(-2)!.image!.id, draft.image.id);
    assert.ok(restarted.preview("lin", draft.image.id));
    assert.deepEqual((await restarted.resolve(draft.image, "lin")).bytes, png);
  }
});
test("identity-based reset/tail removal/edit still cancels replies and clears drafts, without deleting a newly saved reference", async t => {
  const { directory, source, images } = fixture(t);
  const previous: Conversations = { lin: [{ id: "old-user", role: "user", content: "old" }, { id: "old-assistant", role: "assistant", content: "reply" }] };
  const draft = await images.import("lin", source, async () => png);
  const replacement: Conversations = { lin: [message(draft.image)] };
  assert.equal(conversationInterrupted(previous.lin, replacement.lin), true);
  images.reconcile(replacement, previous); assert.ok(images.preview("lin", draft.image.id));
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let finish!: (value: unknown) => void; let signal!: AbortSignal;
  const service = new DesktopService(store, async (_url, _key, body, abort) => {
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    signal = abort!; return new Promise(resolve => { finish = resolve; });
  }, undefined, images.resolve);
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  for (const saved of [{}, { lin: previous.lin!.slice(0, 1) }, { lin: previous.lin!.map(entry => ({ ...entry, content: "edited" })) }]) {
    assert.equal(conversationInterrupted(previous.lin, saved.lin), true);
    const pending = service.chat({ characterId: "lin", messages: [{ role: "user", content: "pending fixture" }] }, "reset-send");
    service.historySaved(previous, saved); assert.equal(signal.aborted, true);
    finish({ choices: [{ message: { content: "late fixture" } }] }); await assert.rejects(pending, /取消/);
  }
  const pendingDraft = await images.import("lin", source, async () => png);
  images.reconcile({}, replacement); assert.equal(images.preview("lin", pendingDraft.image.id), null);
  assert.equal(images.preview("lin", draft.image.id), null);
});
for (const withImage of [false, true]) test(`editing a failed image turn to ${withImage ? "a new image" : "text"} keeps its replacement request through the delayed history save`, async t => {
  const { directory, source, images } = fixture(t);
  const history = new HistoryStore(directory);
  const original = await images.import("lin", source, async () => png);
  const previous: Conversations = { lin: [{ id: "pending-user", role: "user", content: "original failed turn", image: original.image }] };
  history.save(previous); images.reconcile(previous);
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let failing = true, posts = 0;
  let finish!: (value: unknown) => void, transportEntered!: () => void;
  const transportReady = new Promise<void>(accept => { transportEntered = accept; });
  let signal!: AbortSignal;
  let releaseResolution!: () => void, resolutionEntered!: () => void;
  const resolutionReady = new Promise<void>(accept => { resolutionEntered = accept; });
  const resolutionGate = new Promise<void>(accept => { releaseResolution = accept; });
  const service = new DesktopService(store, async (_url, _key, body, abort) => {
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    posts++;
    if (failing) throw new Error("Synthetic failed provider request");
    signal = abort!; transportEntered(); return new Promise(resolve => { finish = resolve; });
  }, undefined, async (attachment, owner, abort) => {
    if (!failing) { signal = abort!; resolutionEntered(); await resolutionGate; }
    return images.resolve(attachment, owner, abort);
  });
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  await assert.rejects(service.chat({ characterId: "lin", messages: [{ role: "user", content: "original failed turn", image: original.image }] }, "failed-original"));
  failing = false;
  const replacementImage = withImage ? await images.import("lin", source, async () => png) : undefined;
  const edited = { id: "pending-user", role: "user" as const, content: "edited replacement", ...(replacementImage ? { image: replacementImage.image } : {}) };
  const replacement: Conversations = { lin: [edited] };
  const input = { characterId: "lin", messages: [{ role: "user" as const, content: edited.content, ...(replacementImage ? { image: replacementImage.image } : {}) }] };
  const pending = service.chat(input, "replacement-send");
  if (withImage) await resolutionReady; else await transportReady;
  history.save(replacement); const saved = history.load(); service.historySaved(previous, saved); images.reconcile(saved, previous);
  assert.equal(signal.aborted, false); assert.equal(images.preview("lin", original.image.id), null);
  if (replacementImage) assert.ok(images.preview("lin", replacementImage.image.id));
  releaseResolution(); await transportReady;
  finish({ choices: [{ message: { content: "edited reply" } }] });
  assert.equal((await pending).content, "edited reply"); assert.equal(posts, 2);
  const completed = { lin: [...saved.lin!, { id: "replacement-reply", role: "assistant" as const, content: "edited reply" }] };
  history.save(completed); images.reconcile(completed, saved);
  const restarted = new ChatImageStore(directory); restarted.reconcile(history.load());
  if (replacementImage) assert.ok(restarted.preview("lin", replacementImage.image.id));
  else assert.equal(history.load().lin![0].image, undefined);
});
test("bound active input still cancels on reset, input edit, removal, and identical-text replacement with a different history ID", async t => {
  const { directory } = fixture(t);
  const store = new ConnectionStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" });
  let finish!: (value: unknown) => void, signal!: AbortSignal;
  const service = new DesktopService(store, async (_url, _key, body, abort) => {
    if (!body) return { data: [{ id: "deepseek-flash" }] };
    signal = abort!; return new Promise(resolve => { finish = resolve; });
  });
  await service.connect({ baseUrl: "https://provider.example", apiKey: "synthetic-fixture-key", remember: false });
  const basis: Conversations = { lin: [{ id: "active-user", role: "user", content: "actual input" }] };
  for (const saved of [{}, { lin: [] }, { lin: [{ ...basis.lin![0], content: "edited" }] }, { lin: [{ ...basis.lin![0], id: "different-user" }] }]) {
    const pending = service.chat({ characterId: "lin", messages: [{ role: "user", content: "actual input" }] }, "basis-send");
    service.historySaved({}, basis); assert.equal(signal.aborted, false);
    service.historySaved(basis, saved); assert.equal(signal.aborted, true);
    finish({ choices: [{ message: { content: "late" } }] }); await assert.rejects(pending, /取消/);
  }
  // A completed older turn with identical text cannot become a new Send's
  // history identity before the new pending user turn has been persisted.
  const completed: Conversations = { lin: [...basis.lin!, { id: "old-reply", role: "assistant", content: "reply" }] };
  const appended: Conversations = { lin: [...completed.lin!, { id: "new-user", role: "user", content: "actual input" }] };
  const pending = service.chat({ characterId: "lin", messages: [{ role: "user", content: "actual input" }] }, "repeat-send");
  service.historySaved(completed, completed); assert.equal(signal.aborted, false);
  service.historySaved(completed, appended); assert.equal(signal.aborted, false);
  service.historySaved(appended, completed); assert.equal(signal.aborted, true);
  finish({ choices: [{ message: { content: "late" } }] }); await assert.rejects(pending, /取消/);
});
