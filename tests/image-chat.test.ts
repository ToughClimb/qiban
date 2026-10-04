import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createProvider, type ProviderFetch } from "../server/provider.js";
import { parseChat } from "../server/validation.js";
import { modelRequest, prepareImageModelRequest, IMAGE_OMISSION_TEXT, MAX_IMAGE_PROVIDER_BYTES } from "../server/model.js";
import { imageDataUrl, type ChatImageResolver } from "../server/image-chat.js";
import { isChatImageAttachment, MAX_CHAT_IMAGE_BYTES, chatImageIds, type ChatImageAttachment } from "../shared/image-chat.js";
import { fitsChatBudget, prepareChatContext, utf8Bytes } from "../shared/chat.js";
import type { ChatRequest } from "../shared/characters.js";
import { readConversations, writeConversations, resetConversation, replaceConversation } from "../shared/history.js";
function chunk(kind: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(kind, 4, "ascii"); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(width = 1, height = 1) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * (width * 3 + 1) + x * 3 + 1] = 255;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
const bytes = png();
const attachment = (number = 1, imageBytes = bytes, width = 1, height = 1): ChatImageAttachment => ({
  id: `image-00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`,
  mimeType: "image/png", byteLength: imageBytes.length, width, height,
});
const request = (image = attachment(), content = "What is in this synthetic image?"): ChatRequest => ({
  characterId: "lin", messages: [{ role: "user", content, image }],
});
const resolver: ChatImageResolver = async image => ({ attachment: image, bytes });
function imageHistory(count: number): ChatRequest {
  return { characterId: "lin", messages: Array.from({ length: count * 2 - 1 }, (_, index) => index % 2
    ? { role: "assistant", content: "synthetic answer" }
    : { role: "user", content: `synthetic image ${index / 2 + 1}`, image: attachment(index / 2 + 1) }) };
}
test("reference contract rejects paths, URLs, encoded data, animations, invalid dimensions and oversized images", () => {
  assert.equal(isChatImageAttachment(attachment()), true);
  for (const invalid of [null, [], { ...attachment(), id: "../image.png" }, { ...attachment(), id: "https://example.invalid/x" },
    { ...attachment(), mimeType: "image/svg+xml" }, { ...attachment(), mimeType: "image/gif" },
    { ...attachment(), width: 1601 }, { ...attachment(), height: 0 }, { ...attachment(), width: 1.5 },
    { ...attachment(), byteLength: MAX_CHAT_IMAGE_BYTES + 1 }, { ...attachment(), byteLength: -1 },
    { ...attachment(), previewUrl: "data:image/png;base64,AA==" }, { ...attachment(), filePath: "/private/image.png" },
    { ...attachment(), bytes: "AA==" }]) assert.equal(isChatImageAttachment(invalid), false);
  assert.equal(parseChat(request()), null); // Public web adapter has no attachment capability.
  assert.deepEqual(parseChat(request(), undefined, { allowImages: true }), request());
  assert.ok(parseChat(request(attachment(), ""), undefined, { allowImages: true }));
  assert.equal(parseChat({ characterId: "lin", messages: [{ role: "user", content: "" }] }, undefined, { allowImages: true }), null);
  assert.equal(parseChat({ ...request(), messages: [request().messages[0], { role: "assistant", content: "answer", image: attachment(2) }, { role: "user", content: "next" }] }, undefined, { allowImages: true }), null);
  assert.equal(parseChat(imageHistory(4), undefined, { allowImages: true }), null);
  assert.equal(parseChat({ ...request(), messages: [{ ...request().messages[0], imageOmitted: true }] }, undefined, { allowImages: true }), null);
});
test("context keeps three latest images, reports omissions, leaves persisted originals intact and accounts for dropped turns", () => {
  const original = imageHistory(5), snapshot = JSON.stringify(original);
  assert.equal(fitsChatBudget(original), false);
  const prepared = prepareChatContext(original);
  assert.equal(fitsChatBudget(prepared.request), true);
  assert.deepEqual(chatImageIds(prepared.request.messages), [attachment(3).id, attachment(4).id, attachment(5).id]);
  assert.deepEqual(prepared.omittedImageIds, [attachment(1).id, attachment(2).id]);
  assert.equal(prepared.request.messages[0].imageOmitted, true);
  assert.equal(prepared.request.messages[2].imageOmitted, true);
  assert.equal(JSON.stringify(original), snapshot);
  const long = imageHistory(4); long.messages.forEach(message => message.content = "中".repeat(message.role === "assistant" ? 7900 : 1900));
  const trimmed = prepareChatContext(long);
  assert.deepEqual(trimmed.request.messages.at(-1), long.messages.at(-1));
  assert.ok(trimmed.omittedImageIds.length > 1);
  assert.ok(fitsChatBudget(trimmed.request));
  assert.throws(() => prepareChatContext({ characterId: "lin", messages: [{ role: "user", content: "x", image: { ...attachment(), width: 1601 } }] }), /Invalid image/);
});
test("trusted serialization emits standard multimodal content and explicit omissions, never IDs or preview/file URLs", async () => {
  const calls: string[] = [];
  const prepared = await prepareImageModelRequest(imageHistory(4), "deepseek-flash", true, undefined, async (image, owner) => {
    assert.equal(owner, "lin"); calls.push(image.id); return { attachment: image, bytes };
  });
  assert.deepEqual(calls, [attachment(2).id, attachment(3).id, attachment(4).id]);
  assert.deepEqual(prepared.omittedImageIds, [attachment(1).id]);
  assert.deepEqual(prepared.body.thinking, { type: "disabled" });
  assert.ok(prepared.body.messages.some(message => typeof message.content === "string" && message.content.includes(IMAGE_OMISSION_TEXT)));
  const last = prepared.body.messages.at(-1)!;
  assert.equal(last.role, "user");
  assert.deepEqual(last.content, [
    { type: "text", text: "synthetic image 4" },
    { type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}`, detail: "original" } },
  ]);
  assert.ok(!JSON.stringify(prepared.body).includes("image-00000000"));
  assert.ok(utf8Bytes(JSON.stringify(prepared.body)) <= MAX_IMAGE_PROVIDER_BYTES);
  const text: ChatRequest = { characterId: "lin", messages: [{ role: "user", content: "text only" }] };
  assert.deepEqual((await prepareImageModelRequest(text, "fixture", false)).body, modelRequest(text, "fixture", false));
  assert.throws(() => modelRequest(request(), "deepseek-flash", true), /trusted image/);
});
test("normalized JPEG and WebP are serialized with their actual MIME type; maximum-size image bodies remain bounded", async () => {
  // Generated nonsensitive 2x1 red fixtures, encoded locally with Pillow.
  const fixtures = [
    { mimeType: "image/jpeg" as const, encoded: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z" },
    { mimeType: "image/webp" as const, encoded: "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=" },
  ];
  for (const fixture of fixtures) {
    const imageBytes = Buffer.from(fixture.encoded, "base64");
    const image = { ...attachment(1, imageBytes, 2, 1), mimeType: fixture.mimeType };
    const result = await prepareImageModelRequest(request(image), "deepseek-flash", true, undefined, async () => ({ attachment: image, bytes: imageBytes }));
    assert.ok(JSON.stringify(result.body).includes(`data:${fixture.mimeType};base64,${fixture.encoded}`));
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(600); header.writeUInt32BE(580, 4); header[8] = 8; header[9] = 2;
  const pixels = randomBytes((600 * 3 + 1) * 580);
  for (let row = 0; row < 580; row++) pixels[row * (600 * 3 + 1)] = 0;
  const imageBytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(imageBytes.length <= MAX_CHAT_IMAGE_BYTES && imageBytes.length > MAX_CHAT_IMAGE_BYTES * 0.99);
  const images = imageHistory(3); images.messages.forEach(message => { if (message.image) message.image = attachment(Number(message.image.id.slice(-12)), imageBytes, 600, 580); });
  const result = await prepareImageModelRequest(images, "deepseek-flash", true, undefined, async image => ({ attachment: image, bytes: imageBytes }));
  const bodyBytes = utf8Bytes(JSON.stringify(result.body));
  assert.ok(bodyBytes > 4 * 1024 * 1024 - 32 * 1024);
  assert.ok(bodyBytes <= MAX_IMAGE_PROVIDER_BYTES);
});

test("serialization rejects absent stores, unsupported models, mismatches, active formats and metadata before any provider call", async () => {
  await assert.rejects(prepareImageModelRequest(request(), "deepseek-flash", true), /trusted store/);
  await assert.rejects(prepareImageModelRequest(request(), "deepseek-v4-pro", true, undefined, resolver), /deepseek-flash/);
  await assert.rejects(prepareImageModelRequest(request(), "deepseek-flash", false, undefined, resolver), /deepseek-flash/);
  const animation = Buffer.concat([bytes.subarray(0, 33), chunk("acTL", Buffer.alloc(8)), bytes.subarray(33)]);
  const metadata = Buffer.concat([bytes.subarray(0, 33), chunk("tEXt", Buffer.from("private metadata")), bytes.subarray(33)]);
  const corrupt = Buffer.from(bytes); corrupt[40] ^= 1;
  for (const bad of [animation, metadata, corrupt, Buffer.from("<svg/>"), Buffer.from("GIF89a")]) {
    const image = attachment(1, bad);
    assert.throws(() => imageDataUrl(image, { attachment: image, bytes: bad }), /Invalid stored/);
  }
  for (const resolved of [{ attachment: attachment(2), bytes }, { attachment: attachment(), bytes: Buffer.alloc(1) },
    { attachment: { ...attachment(), width: 2 }, bytes }])
    assert.throws(() => imageDataUrl(attachment(), resolved), /Invalid stored/);
  assert.throws(() => imageDataUrl({ ...attachment(), mimeType: "image/jpeg" }, { attachment: { ...attachment(), mimeType: "image/jpeg" }, bytes }), /Invalid stored/);
  assert.throws(() => imageDataUrl({ ...attachment(), width: 2 }, { attachment: { ...attachment(), width: 2 }, bytes }), /Invalid stored/);
  let calls = 0;
  const provider = createProvider({ mode: "live", apiKey: "synthetic-only" }, async () => { calls++; throw new Error("Unexpected fetch"); }, async image => ({ attachment: image, bytes: corrupt }));
  try { await assert.rejects(provider.reply(request()), /Invalid stored/); assert.equal(calls, 0); }
  finally { await provider.close?.(); }
  await assert.rejects(createProvider({ mode: "demo" }).reply(request()), /unavailable in demo/);
});
test("cancellation stops resolution and the live adapter makes one bounded serialized request", async () => {
  let calls = 0;
  const fetcher: ProviderFetch = async (url, options) => {
    calls++; assert.equal(url, "https://api.deepseek.com/chat/completions"); assert.equal(options.redirect, "error");
    assert.ok(options.dispatcher); const body = JSON.parse(options.body);
    assert.deepEqual(body.thinking, { type: "disabled" }); assert.equal(body.messages.at(-1).content[1].type, "image_url");
    return { ok: true, json: async () => ({ choices: [{ message: { content: "synthetic answer", reasoning_content: "ignored" } }] }) };
  };
  const provider = createProvider({ mode: "live", apiKey: "synthetic-only" }, fetcher, resolver);
  try {
    assert.equal(await provider.reply(request()), "synthetic answer"); assert.equal(calls, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(provider.reply(request(), controller.signal), { name: "AbortError" }); assert.equal(calls, 1);
  } finally { await provider.close?.(); }
  const controller = new AbortController(); let resolutions = 0;
  await assert.rejects(prepareImageModelRequest(imageHistory(3), "deepseek-flash", true, undefined, async image => {
    resolutions++; controller.abort(); return { attachment: image, bytes };
  }, controller.signal), { name: "AbortError" });
  assert.equal(resolutions, 1);
});
test("cancellation returns while local resolution is pending and a late result cannot send", async () => {
  const controller = new AbortController();
  let started!: () => void, finish!: (value: { attachment: ChatImageAttachment; bytes: Buffer }) => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const provider = createProvider({ mode: "live", apiKey: "synthetic-only" }, async () => { calls++; throw new Error("Unexpected fetch"); }, image => {
    started(); return new Promise(resolve => { finish = resolve; });
  });
  try {
    const pending = provider.reply(request(), controller.signal);
    await entered; controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    finish({ attachment: attachment(), bytes });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
  } finally { await provider.close?.(); }
});

test("history round trips reference metadata without encoded data, preserves deletion references and refuses request-only/unsafe fields", () => {
  const messages = [{ id: "u1", ...request().messages[0] }];
  let raw = "";
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const history = replaceConversation({}, "lin", messages);
  assert.equal(writeConversations(storage, history), true);
  assert.deepEqual(readConversations(storage), history);
  assert.ok(!raw.includes("base64")); assert.deepEqual(chatImageIds(history.lin!), [attachment().id]);
  assert.deepEqual(resetConversation(history, "lin"), {});
  for (const extra of [{ previewUrl: "data:image/png;base64,AA==" }, { imageOmitted: true }, { image: { ...attachment(), bytes: "AA==" } }]) {
    const invalid = { lin: [{ ...messages[0], ...extra }] };
    assert.equal(writeConversations(storage, invalid), false);
    assert.deepEqual(readConversations({ getItem: () => JSON.stringify(invalid) }), {});
  }
  assert.equal(raw, JSON.stringify(history));
});
test("web adapter rejects opaque attachment requests without storage resolution or provider calls", async () => {
  let calls = 0;
  const server = createApp({ mode: "demo" }, { reply: async () => { calls++; return "Unexpected answer"; } }).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request()),
    });
    assert.equal(response.status, 400); assert.equal(calls, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
