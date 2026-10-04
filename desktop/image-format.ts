import { ConnectionError } from "./network.js";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 1024 * 1024;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
export function imageError(): never {
  throw new ConnectionError("avatar", "请选择有效的 PNG、JPEG 或静态 WebP 图片，文件不超过 5 MiB，长宽不超过 4096 像素。");
}
function dimensions(width: number, height: number) {
  if (!width || !height || width > 4096 || height > 4096) imageError();
  return { width, height };
}
export function pngChunks(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(pngSignature)) imageError();
  const chunks: { kind: string; bytes: Buffer }[] = [];
  let position = 8;
  while (position + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(position);
    const end = position + size + 12;
    if (end > bytes.length) imageError();
    const kind = bytes.toString("ascii", position + 4, position + 8);
    if (kind === "acTL" || kind === "fdAT") imageError();
    chunks.push({ kind, bytes: bytes.subarray(position, end) });
    position = end;
    if (kind === "IEND") break;
  }
  if (position !== bytes.length || chunks[0]?.kind !== "IHDR" ||
      chunks[0].bytes.length !== 25 || chunks.at(-1)?.kind !== "IEND" ||
      chunks.filter((chunk) => chunk.kind === "IHDR").length !== 1 ||
      !chunks.some((chunk) => chunk.kind === "IDAT")) imageError();
  return chunks;
}
export function imageFormat(bytes: Buffer): { mime: string; width: number; height: number } {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) imageError();
  if (bytes.subarray(0, 8).equals(pngSignature)) {
    const header = pngChunks(bytes)[0].bytes;
    return { mime: "image/png", ...dimensions(header.readUInt32BE(8), header.readUInt32BE(12)) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let position = 2;
    let size: { width: number; height: number } | undefined;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 0xff) imageError();
      while (bytes[position] === 0xff) position++;
      if (position + 3 > bytes.length) imageError();
      const marker = bytes[position++];
      if (marker === 0xda) break;
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) imageError();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) imageError();
        size = dimensions(bytes.readUInt16BE(position + 5), bytes.readUInt16BE(position + 3));
      }
      position += length;
    }
    if (!size) imageError();
    return { mime: "image/jpeg", ...size };
  }
  if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) {
    let position = 12;
    let size: { width: number; height: number } | undefined;
    let frames = 0;
    while (position + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", position, position + 4);
      const length = bytes.readUInt32LE(position + 4);
      const start = position + 8;
      const end = start + length;
      if (end > bytes.length || ["ANIM", "ANMF"].includes(kind)) imageError();
      if (kind === "VP8X") {
        if (length !== 10 || (bytes[start] & 2)) imageError();
        size = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
      } else if (kind === "VP8 ") {
        if (length < 10 || bytes[start] & 1 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) imageError();
        const frame = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
        size ??= frame;
        frames++;
      } else if (kind === "VP8L") {
        if (length < 5 || bytes[start] !== 0x2f) imageError();
        const bits = bytes.readUInt32LE(start + 1);
        const frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        size ??= frame;
        frames++;
      }
      position = end + (length & 1);
    }
    if (position !== bytes.length || frames !== 1 || !size) imageError();
    return { mime: "image/webp", ...size };
  }
  return imageError();
}
export function normalizedPng(bytes: Buffer): Buffer {
  const format = imageFormat(bytes);
  if (format.mime !== "image/png" || format.width > 512 || format.height > 512 || bytes.length > MAX_AVATAR_BYTES) imageError();
  const allowed = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  return Buffer.concat([pngSignature, ...pngChunks(bytes).filter((chunk) => allowed.has(chunk.kind)).map((chunk) => chunk.bytes)]);
}
