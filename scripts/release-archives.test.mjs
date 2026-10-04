import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyArchiveContents } from "./release-archives.mjs";

// Minimal stored ZIP fixtures exercise the real ZIP reader without another dependency.
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(bytes), 16); record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(header, filename, bytes); central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}
async function fixture(entries, exercise) {
  const directory = await mkdtemp(join(tmpdir(), "qiban-license-test-"));
  try {
    const file = join(directory, "synthetic.nupkg"); await writeFile(file, zip(entries));
    await exercise(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const expected = new Map([
  ["LICENSE", Buffer.from("synthetic Electron notice")],
  ["LICENSES.chromium.html", Buffer.from("synthetic Chromium notice")],
  ["resources/THIRD_PARTY_NOTICES.txt", Buffer.from("synthetic dependency notice")],
]);
const entries = [...expected].map(([name, bytes]) => [`lib/net45/${name}`, bytes]);

test("Squirrel archive audit requires Chromium HTML and exact notice bytes, including its standard nested layout", async () => {
  await fixture(entries, file => verifyArchiveContents(file, expected));
  await fixture(entries.filter(([name]) => !name.endsWith("LICENSES.chromium.html")), async file =>
    assert.rejects(verifyArchiveContents(file, expected), /missing: LICENSES.chromium.html/));
  await fixture(entries.map(([name, bytes]) => [name, name.endsWith("LICENSE") ? Buffer.from("changed notice") : bytes]), async file =>
    assert.rejects(verifyArchiveContents(file, expected), /bytes differ/));
});

test("private data and duplicate payload entries cannot pass the archive audit", async () => {
  await fixture([...entries, ["lib/net45/resources/connection.json", Buffer.from("synthetic-only")]], async file =>
    assert.rejects(verifyArchiveContents(file, expected), /private/));
  await fixture([...entries, ["duplicate/LICENSE", expected.get("LICENSE")]], async file =>
    assert.rejects(verifyArchiveContents(file, expected), /Duplicate/));
});
