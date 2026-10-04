import { crc32 } from "node:zlib";
import {
  isChatImageAttachment,
  type ChatImageAttachment,
  type ChatImageMime,
} from "../shared/image-chat.js";

// Only a native store may supply this: decoded, normalized, metadata-free app-owned bytes.
// Resolving must check conversation ownership and never interpret an ID as a path/URL.
export type TrustedChatImage = { attachment: ChatImageAttachment; bytes: Uint8Array };
export type ChatImageResolver = (
  image: ChatImageAttachment,
  characterId: string,
  signal?: AbortSignal,
) => Promise<TrustedChatImage>;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
function invalid(): never { throw new Error("Invalid stored chat image"); }
function format(bytes: Buffer): { mimeType: ChatImageMime; width: number; height: number } {
  if (bytes.subarray(0, 8).equals(pngSignature)) {
    let offset = 8;
    let width = 0, height = 0, data = false, ended = false;
    const allowed = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) invalid();
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (!allowed.has(kind) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
      if (offset === 8 && (kind !== "IHDR" || length !== 13)) invalid();
      if (kind === "IHDR") {
        if (offset !== 8) invalid();
        width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      }
      if (kind === "IDAT") data = true;
      offset = end;
      if (kind === "IEND") { if (length !== 0) invalid(); ended = true; break; }
    }
    if (!ended || !data || offset !== bytes.length) invalid();
    return { mimeType: "image/png", width, height };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let width = 0, height = 0, scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      if (offset + 3 > bytes.length) invalid();
      const marker = bytes[offset++];
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      // Normalized JPEG may keep JFIF/Adobe codec markers, but no EXIF/ICC/XMP/comments.
      if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xee)) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || width) invalid();
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      }
      if (marker === 0xda) { scan = true; break; }
      offset += length;
    }
    if (!scan || !width || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalid();
    return { mimeType: "image/jpeg", width, height };
  }
  if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) {
    let offset = 12, width = 0, height = 0, frames = 0;
    let canvas: { width: number; height: number } | undefined;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
      if (end > bytes.length || !["VP8X", "VP8 ", "VP8L", "ALPH"].includes(kind)) invalid();
      if (kind === "VP8X") {
        if (canvas || length !== 10 || (bytes[start] & ~0x10)) invalid();
        canvas = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
      } else if (kind === "VP8 ") {
        if (length < 10 || (bytes[start] & 1) || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) invalid();
        width = bytes.readUInt16LE(start + 6) & 0x3fff; height = bytes.readUInt16LE(start + 8) & 0x3fff; frames++;
      } else if (kind === "VP8L") {
        if (length < 5 || bytes[start] !== 0x2f) invalid();
        const bits = bytes.readUInt32LE(start + 1);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; frames++;
      }
      offset = end + (length & 1);
    }
    if (frames !== 1 || offset !== bytes.length || (canvas && (width !== canvas.width || height !== canvas.height))) invalid();
    return { mimeType: "image/webp", width, height };
  }
  return invalid();
}
export function imageDataUrl(expected: ChatImageAttachment, resolved: TrustedChatImage): string {
  if (!isChatImageAttachment(expected) || !isChatImageAttachment(resolved?.attachment) ||
      !(resolved.bytes instanceof Uint8Array) || resolved.bytes.byteLength !== expected.byteLength ||
      Object.keys(expected).some(key => expected[key as keyof ChatImageAttachment] !== resolved.attachment[key as keyof ChatImageAttachment])) invalid();
  const bytes = Buffer.from(resolved.bytes.buffer, resolved.bytes.byteOffset, resolved.bytes.byteLength);
  const actual = format(bytes);
  if (actual.mimeType !== expected.mimeType || actual.width !== expected.width || actual.height !== expected.height) invalid();
  return `data:${actual.mimeType};base64,${bytes.toString("base64")}`;
}
