import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarStore, avatarId } from "../desktop/avatars.js";
import { imageFormat, normalizedPng, MAX_IMAGE_BYTES } from "../desktop/image-format.js";
import { CardStore } from "../desktop/cards.js";
import { modelRequest } from "../server/model.js";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
function chunk(kind: string, data: Buffer) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(kind, 4, "ascii"); data.copy(bytes, 8);
  return bytes;
}
function webp(width: number, height: number) {
  const data = Buffer.alloc(6); data[0] = 0x2f;
  data.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  const frame = Buffer.alloc(14); frame.write("VP8L"); frame.writeUInt32LE(5, 4); data.copy(frame, 8);
  const header = Buffer.alloc(12); header.write("RIFF"); header.writeUInt32LE(18, 4); header.write("WEBP", 8);
  return Buffer.concat([header, frame]);
}
test("image preflight bounds PNG/JPEG/WebP and rejects active formats and animation before decoding", () => {
  assert.deepEqual(imageFormat(png), { mime: "image/png", width: 1, height: 1 });
  assert.deepEqual(imageFormat(webp(4096, 4096)), { mime: "image/webp", width: 4096, height: 4096 });
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,8,8,0,32,0,64,0,0xff,0xda,0,2]);
  assert.deepEqual(imageFormat(jpeg), { mime: "image/jpeg", width: 64, height: 32 });
  const largePng = Buffer.from(png); largePng.writeUInt32BE(4097, 16);
  const animated = Buffer.concat([png.subarray(0, 33), chunk("acTL", Buffer.alloc(8)), png.subarray(33)]);
  for (const bytes of [largePng, animated, webp(4097, 1), Buffer.alloc(MAX_IMAGE_BYTES + 1), Buffer.from("<svg onload='alert(1)'/>"), Buffer.from("<html/>"), Buffer.from([0xff,0xd8,0xff,0xff])])
    assert.throws(() => imageFormat(bytes));
  for (const id of ["../lin", "lin/../../outside", "new", "card-invalid", "https://remote.invalid/avatar.png", {}, null])
    assert.throws(() => avatarId(id));
});
test("app-owned avatars retain stable IDs, strip metadata and do not alter card JSON or accept its image URLs", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-avatar-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "chosen.png");
  const metadata = chunk("tEXt", Buffer.from("synthetic private metadata"));
  const withMetadata = Buffer.concat([png.subarray(0, 33), metadata, png.subarray(33)]);
  writeFileSync(source, withMetadata);
  const cards = new CardStore(directory); cards.list();
  const original = JSON.stringify({name:"fixture", first_mes:"hello", avatarUrl:"https://remote.invalid/private-image"});
  const id = cards.commit(cards.preview(original).token, true);
  assert.equal(cards.list().characters.find((character) => character.id === id)?.avatarUrl, undefined);
  const avatars = new AvatarStore(directory);
  const url = await avatars.import(id, source, async (bytes, mime) => {
    assert.equal(mime, "image/png"); assert.deepEqual(bytes, withMetadata); return withMetadata;
  });
  assert.match(url, new RegExp(`^qiban://app/avatars/${id}/[0-9a-f]{64}\\.png$`));
  const hash = new URL(url).pathname.split("/").at(-1)!.slice(0, -4);
  assert.deepEqual(avatars.image(id, hash), png);
  assert.equal(avatars.image(id, "0".repeat(64)), undefined);
  assert.equal(readFileSync(source).includes(Buffer.from("synthetic private metadata")), true);
  assert.equal(readFileSync(join(avatars.directory, `${id}.png`)).includes(Buffer.from("synthetic private metadata")), false);
  assert.equal(cards.original(id), original);
  const request = JSON.stringify(modelRequest({ characterId: id, messages: [{ role: "user", content: "hello" }] }, "synthetic-model", true, cards.persona(id)));
  assert.equal(request.includes("avatar"), false);
  assert.equal(request.includes("remote.invalid"), false);
  assert.equal(request.includes("qiban://"), false);
  assert.equal(new AvatarStore(directory).url(id), url);
  await avatars.import("lin", source, async () => png);
  avatars.delete(id);
  assert.equal(avatars.url(id), undefined);
  assert.ok(avatars.url("lin"));
  assert.deepEqual(normalizedPng(withMetadata), png);
});
test("invalid files and decode failures preserve the old image; deletion cancels late imports and clears all avatars", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-avatar-delete-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const avatars = new AvatarStore(directory);
  const source = join(directory, "chosen.png"); writeFileSync(source, png);
  const url = await avatars.import("lin", source, async () => png);
  await assert.rejects(avatars.import("lin", source, async () => { throw new Error("synthetic decoder failure"); }));
  assert.equal(avatars.url("lin"), url);
  const bad = join(directory, "bad.png"); writeFileSync(bad, "<svg/>");
  let calls = 0;
  await assert.rejects(avatars.import("lin", bad, async () => { calls++; return png; }));
  assert.equal(calls, 0); assert.equal(avatars.url("lin"), url);
  const oversized = join(directory, "large.png"); writeFileSync(oversized, Buffer.alloc(MAX_IMAGE_BYTES + 1));
  await assert.rejects(avatars.import("lin", oversized, async () => { calls++; return png; }));
  assert.equal(calls, 0);
  if (process.platform !== "win32") {
    const link = join(directory, "link.png"); symlinkSync(source, link);
    await assert.rejects(avatars.import("lin", link, async () => png));
  }
  const unsafe = new AvatarStore(join(directory, "unsafe")); mkdirSync(join(directory, "unsafe"));
  symlinkSync(avatars.directory, unsafe.directory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(unsafe.import("moon", source, async () => png));
  assert.equal(avatars.url("moon"), undefined);
  let finish!: (value: Buffer) => void;
  const pending = avatars.import("lin", source, () => new Promise((resolve) => { finish = resolve; }));
  avatars.clear(); finish(png);
  await assert.rejects(pending, /取消/);
  assert.equal(existsSync(avatars.directory), false);
  assert.equal(avatars.url("lin"), undefined);
});
