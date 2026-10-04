import { randomUUID } from "node:crypto";
import { mkdirSync, lstatSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { avatarId, readRegular } from "./avatars.js";
import { imageFormat, pngChunks, MAX_IMAGE_BYTES } from "./image-format.js";
import { ConnectionError } from "./network.js";
import { CHAT_IMAGE_ID, MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_EDGE, type ChatImageAttachment, type ChatImageDraft } from "../shared/image-chat.js";
import type { Conversations } from "../shared/history.js";
import { imageDataUrl, type ChatImageResolver } from "../server/image-chat.js";

const failure = () => new ConnectionError("image", "图片无法读取，请重新选择有效的 PNG、JPEG 或静态 WebP 图片（不超过 5 MiB、4096 像素）。");
const cancelled = () => new ConnectionError("cancelled", "图片选择已取消。");
function imageId(value: unknown): string {
  if (typeof value !== "string" || !CHAT_IMAGE_ID.test(value)) throw failure();
  return value;
}
function directoryExists(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
// Files contain normalized PNG bytes only. History owns durable references; drafts
// are ephemeral and disappear on replacement, discard, process exit or restart.
export class ChatImageStore {
  readonly directory: string;
  private selection = 0;
  private revisions = new Map<string, number>();
  private drafts = new Map<string, ChatImageAttachment>();
  private references = new Map<string, Map<string, ChatImageAttachment>>();
  constructor(directory: string) { this.directory = join(directory, "chat-images"); }
  private ownerDirectory(owner: string, create = false): string {
    avatarId(owner);
    if (!directoryExists(this.directory) && create) mkdirSync(this.directory, { mode: 0o700 });
    const path = join(this.directory, owner);
    if (directoryExists(this.directory)) {
      if (!directoryExists(path) && create) mkdirSync(path, { mode: 0o700 });
    }
    return path;
  }
  private file(owner: string, id: string, create = false) {
    return join(this.ownerDirectory(owner, create), `${imageId(id)}.png`);
  }
  private remove(owner: string, id: string) { rmSync(this.file(owner, id), { force: true }); }
  beginSelection(owner: string) {
    avatarId(owner);
    this.discardDrafts();
    const selection = ++this.selection;
    const revision = this.revisions.get(owner) ?? 0;
    this.revisions.set(owner, revision);
    return () => selection === this.selection && revision === (this.revisions.get(owner) ?? 0);
  }
  async import(owner: string, source: string, decode: (bytes: Buffer, mime: string) => Promise<Buffer>, current = this.beginSelection(owner)): Promise<ChatImageDraft> {
    try {
      if (!current()) throw cancelled();
      if (!/\.(png|jpe?g|webp)$/i.test(extname(source))) throw failure();
      const bytes = readRegular(source, MAX_IMAGE_BYTES);
      const format = imageFormat(bytes);
      const decoded = await decode(bytes, format.mime);
      if (!current()) throw cancelled();
      const normalized = imageFormat(decoded);
      if (normalized.mime !== "image/png" || normalized.width > MAX_CHAT_IMAGE_EDGE || normalized.height > MAX_CHAT_IMAGE_EDGE) throw failure();
      const allowed = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
      const png = Buffer.concat([decoded.subarray(0, 8), ...pngChunks(decoded).filter(chunk => allowed.has(chunk.kind)).map(chunk => chunk.bytes)]);
      const image: ChatImageAttachment = { id: `image-${randomUUID()}`, mimeType: "image/png", byteLength: png.length, width: normalized.width, height: normalized.height };
      // Shared serializer verifies metadata-free output and the 1 MiB budget.
      imageDataUrl(image, { attachment: image, bytes: png });
      writeFileSync(this.file(owner, image.id, true), png, { flag: "wx", mode: 0o600 });
      this.drafts.set(owner, image);
      return { image, previewUrl: this.preview(owner, image.id)! };
    } catch (error) {
      if (error instanceof ConnectionError && error.code === "cancelled") throw error;
      throw failure();
    }
  }
  private attachment(owner: string, id: string): ChatImageAttachment | undefined {
    avatarId(owner); imageId(id);
    const draft = this.drafts.get(owner);
    return draft?.id === id ? draft : this.references.get(owner)?.get(id);
  }
  private read(owner: string, id: string) {
    const attachment = this.attachment(owner, id);
    if (!attachment) throw failure();
    const bytes = readRegular(this.file(owner, id), MAX_CHAT_IMAGE_BYTES);
    imageDataUrl(attachment, { attachment, bytes });
    return { attachment, bytes };
  }
  readonly resolve: ChatImageResolver = async (expected, owner, signal) => {
    signal?.throwIfAborted();
    const resolved = this.read(owner, expected.id);
    imageDataUrl(expected, resolved);
    signal?.throwIfAborted();
    return resolved;
  };
  preview(owner: string, id: string): string | null {
    avatarId(owner); imageId(id);
    try { const resolved = this.read(owner, id); return imageDataUrl(resolved.attachment, resolved); } catch { return null; }
  }
  image(owner: string, id: string): Buffer | undefined {
    try { return this.read(owner, id).bytes; } catch { return; }
  }
  discard(owner: string, id: string) {
    avatarId(owner); imageId(id);
    if (this.references.get(owner)?.has(id)) return;
    if (this.drafts.get(owner)?.id === id) {
      this.drafts.delete(owner);
      this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1);
    }
    this.remove(owner, id);
  }
  discardDrafts() {
    this.selection++;
    for (const [owner, draft] of this.drafts) {
      if (!this.references.get(owner)?.has(draft.id)) this.remove(owner, draft.id);
    }
    this.drafts.clear();
  }
  deleteCharacter(owner: string) {
    avatarId(owner);
    this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1);
    this.drafts.delete(owner);
    this.references.delete(owner);
    const path = this.ownerDirectory(owner);
    rmSync(path, { recursive: true, force: true });
  }
  // Invoke only after a successful history save. Reset invalidates an in-flight
  // picker/decode for that owner; pruning never touches another owner's files.
  reconcile(history: Conversations, previous?: Conversations) {
    if (previous) {
      for (const owner of new Set([...Object.keys(previous), ...Object.keys(history), ...this.drafts.keys(), ...this.revisions.keys()])) {
        if ((previous[owner]?.length ?? 0) > (history[owner]?.length ?? 0) || (Object.hasOwn(previous, owner) && !Object.hasOwn(history, owner))) {
          this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1);
          const draft = this.drafts.get(owner);
          if (draft) { this.remove(owner, draft.id); this.drafts.delete(owner); }
        }
      }
    }
    this.references.clear();
    for (const [owner, messages] of Object.entries(history)) {
      avatarId(owner);
      const references = new Map<string, ChatImageAttachment>();
      for (const message of messages ?? []) if (message.image) references.set(message.image.id, message.image);
      this.references.set(owner, references);
      if (references.has(this.drafts.get(owner)?.id ?? "")) this.drafts.delete(owner);
    }
    if (!directoryExists(this.directory)) return;
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      try { avatarId(entry.name); } catch { continue; }
      const path = this.ownerDirectory(entry.name);
      if (!directoryExists(path)) continue;
      for (const file of readdirSync(path)) {
        const match = /^(image-[a-f0-9-]{36})\.png$/.exec(file);
        if (match && CHAT_IMAGE_ID.test(match[1]) && !this.references.get(entry.name)?.has(match[1]) && this.drafts.get(entry.name)?.id !== match[1]) this.remove(entry.name, match[1]);
      }
    }
  }
  clear() {
    this.selection++;
    for (const owner of this.revisions.keys()) this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1);
    this.drafts.clear(); this.references.clear();
    rmSync(this.directory, { recursive: true, force: true });
  }
}
