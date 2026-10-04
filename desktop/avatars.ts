import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { getCharacter } from "../shared/characters.js";
import { ConnectionError } from "./network.js";
import { imageFormat, imageError, normalizedPng, MAX_IMAGE_BYTES, MAX_AVATAR_BYTES } from "./image-format.js";

export function avatarId(value: unknown): string {
  if (typeof value !== "string" || (!getCharacter(value) && !/^card-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)))
    throw new ConnectionError("avatar", "角色不存在，请重新加载。");
  return value;
}
function readRegular(file: string, limit: number): Buffer {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) imageError();
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || stat.ino !== before.ino || stat.dev !== before.dev) imageError();
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > limit) imageError();
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
export class AvatarStore {
  readonly directory: string;
  private revision = 0;
  constructor(directory: string) { this.directory = join(directory, "avatars"); }
  private ensureDirectory() {
    mkdirSync(this.directory, { recursive: true });
    this.validateDirectory();
  }
  private validateDirectory(): boolean {
    let stat;
    try { stat = lstatSync(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) imageError();
    return true;
  }
  private file(id: unknown) { return join(this.directory, `${avatarId(id)}.png`); }
  private read(id: string) {
    if (!this.validateDirectory()) imageError();
    return normalizedPng(readRegular(this.file(id), MAX_AVATAR_BYTES));
  }
  url(id: string): string | undefined {
    try {
      const hash = createHash("sha256").update(this.read(id)).digest("hex");
      return `qiban://app/avatars/${avatarId(id)}/${hash}.png`;
    } catch { return; }
  }
  image(id: string, hash: string): Buffer | undefined {
    try {
      if (!/^[0-9a-f]{64}$/.test(hash)) return;
      const bytes = this.read(id);
      return createHash("sha256").update(bytes).digest("hex") === hash ? bytes : undefined;
    } catch { return; }
  }
  async import(id: string, source: string, decode: (bytes: Buffer, mime: string) => Promise<Buffer>): Promise<string> {
    const file = this.file(id);
    if (!/\.(png|jpe?g|webp)$/i.test(extname(source))) imageError();
    const bytes = readRegular(source, MAX_IMAGE_BYTES);
    const format = imageFormat(bytes);
    const revision = this.revision;
    const png = normalizedPng(await decode(bytes, format.mime));
    if (revision !== this.revision) throw new ConnectionError("cancelled", "头像导入已取消。");
    this.ensureDirectory();
    const temporary = file + ".tmp";
    writeFileSync(temporary, png, { flag: "wx", mode: 0o600 });
    try { renameSync(temporary, file); }
    finally { rmSync(temporary, { force: true }); }
    return this.url(id)!;
  }
  delete(id: string) {
    const file = this.file(id);
    this.revision++;
    this.validateDirectory();
    rmSync(file, { force: true });
    rmSync(file + ".tmp", { force: true });
  }
  clear() {
    this.revision++;
    rmSync(this.directory, { recursive: true, force: true });
  }
}
