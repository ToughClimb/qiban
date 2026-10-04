import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { readConversations, type Conversations } from "../shared/history.js";
import { utf8Bytes } from "../shared/chat.js";
import { ConnectionError } from "./network.js";
import type { Message } from "../shared/characters.js";

// Appends may evict complete oldest turns (200 -> 199 on the next user send).
// A continuing conversation retains an unchanged suffix through the old tail.
// Losing/editing that tail or rewriting the retained suffix is a reset/edit.
export function conversationInterrupted(previous: readonly Message[] | undefined, next: readonly Message[] | undefined): boolean {
  if (!previous) return false;
  if (!next) return true;
  if (!previous.length) return false;
  const tailIndex = next.findIndex(message => message.id === previous.at(-1)!.id);
  if (tailIndex < 0 || tailIndex + 1 > previous.length) return true;
  const retained = previous.slice(-(tailIndex + 1));
  return retained.some((message, index) => {
    const current = next[index];
    return message.id !== current.id || message.role !== current.role || message.content !== current.content || message.mode !== current.mode ||
      Boolean(message.image) !== Boolean(current.image) ||
      (message.image && current.image && (["id", "mimeType", "byteLength", "width", "height"] as const).some(key => message.image![key] !== current.image![key]));
  });
}
export class HistoryStore {
  private file: string;
  constructor(private directory: string) {
    this.file = join(directory, "history.json");
  }
  load(): Conversations {
    if (!existsSync(this.file)) return {};
    try {
      const buffer = readFileSync(this.file);
      if (buffer.length > 8 * 1024 * 1024) throw new Error();
      const record = JSON.parse(buffer.toString("utf8"));
      if (record.schema_version !== 1) throw new Error();
      const parsed = readConversations({
        getItem: () => JSON.stringify(record.conversations),
      });
      if (JSON.stringify(parsed) !== JSON.stringify(record.conversations))
        throw new Error();
      return parsed;
    } catch {
      throw new ConnectionError(
        "history",
        "聊天记录无法读取。请先备份本地数据，通过角色指南恢复备份，或在设置中清空本地数据。",
      );
    }
  }
  save(value: unknown) {
    let data: string;
    try {
      const raw = JSON.stringify(value);
      if (utf8Bytes(raw) > 8 * 1024 * 1024) throw new Error();
      const parsed = readConversations({ getItem: () => raw });
      if (JSON.stringify(parsed) !== raw) throw new Error();
      data = JSON.stringify(
        { schema_version: 1, conversations: parsed },
        null,
        2,
      );
    } catch {
      throw new ConnectionError(
        "history",
        "聊天记录太大或格式不正确，请清空不需要的记录后重试。",
      );
    }
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(`${this.file}.tmp`, data, { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      throw new ConnectionError(
        "history",
        "聊天记录无法保存，请检查磁盘空间后重试。",
      );
    }
  }
  clear() {
    rmSync(this.file, { force: true });
    rmSync(`${this.file}.tmp`, { force: true });
  }
}
