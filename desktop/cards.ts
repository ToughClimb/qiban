import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  characters,
  getCharacter,
  type Character,
} from "../shared/characters.js";
import {
  parseCharacterCard,
  type RoleplayPersonaV1,
} from "../shared/character-card.js";
import {
  cardFields,
  type CardFields,
  type CardList,
  type CardPreview,
} from "../shared/cards.js";
import { personalities } from "../server/personas.js";
import { ConnectionError } from "./network.js";
const idPattern =
  /^card-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const fieldNames = {
  name: "name",
  description: "description",
  personality: "personality",
  scenario: "scenario",
  firstMessage: "first_mes",
  exampleDialogue: "mes_example",
} as const;
export function sourceText(bytes: Buffer): string {
  if (bytes.length > 128 * 1024)
    throw new ConnectionError("card", "角色文件不能超过 128 KiB。");
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new ConnectionError("card", "角色文件须使用 UTF-8 编码。");
  }
}
function parse(source: string) {
  const result = parseCharacterCard(source);
  if (!result.ok)
    throw new ConnectionError(
      "card",
      result.errors.map((item) => `${item.path}: ${item.message}`).join("\n"),
    );
  return result;
}
function display(id: string, p: RoleplayPersonaV1): Character {
  return {
    id,
    name: p.name,
    kind: "虚拟角色",
    role: "自定义伙伴",
    emoji: "✦",
    color: "sage",
    description: p.description.slice(0, 90) || "按你的设定，慢慢聊。",
    greeting: p.firstMessage || "你好，今天想聊点什么？",
    starters: ["聊聊你今天的日常", "一起想个小故事"],
  };
}
export class CardStore {
  readonly directory: string;
  private entries = new Map<
    string,
    { source: string; persona: RoleplayPersonaV1 }
  >();
  private pending?: {
    token: string;
    source: string;
    persona: RoleplayPersonaV1;
    id?: string;
  };
  constructor(directory: string) {
    this.directory = join(directory, "cards");
  }
  private file(id: string) {
    if (!idPattern.test(id))
      throw new ConnectionError("card", "这个角色无法编辑。");
    return join(this.directory, `${id}.json`);
  }
  private read(id: string) {
    const file = this.file(id);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
      throw new Error();
    return sourceText(readFileSync(file));
  }
  list(): CardList {
    this.entries.clear();
    const issues: string[] = [];
    mkdirSync(this.directory, { recursive: true });
    const files = readdirSync(this.directory)
      .filter(
        (file) =>
          idPattern.test(file.replace(/\.json$/, "")) && file.endsWith(".json"),
      )
      .sort();
    for (const file of files.slice(0, 20)) {
      const id = file.slice(0, -5);
      try {
        const source = this.read(id);
        this.entries.set(id, { source, persona: parse(source).persona });
      } catch {
        issues.push(`${file} 无法读取。请先备份文件，再检查编码和角色字段。`);
      }
    }
    if (files.length > 20)
      issues.push("最多加载 20 个自定义角色。请移走暂时不用的文件后重新加载。");
    return {
      characters: [
        ...characters,
        ...[...this.entries].map(([id, entry]) => display(id, entry.persona)),
      ],
      issues,
    };
  }
  has(id: string) {
    return Boolean(getCharacter(id) || this.entries.has(id));
  }
  persona(id: string) {
    return this.entries.get(id)?.persona;
  }
  fields(id: string): CardFields {
    const entry = this.entries.get(id);
    if (entry) return cardFields(entry.persona);
    const builtin = getCharacter(id);
    if (!builtin) throw new ConnectionError("card", "角色不存在，请重新加载。");
    return {
      name: builtin.name,
      description: builtin.description,
      personality: personalities[id],
      scenario: "",
      firstMessage: builtin.greeting,
      exampleDialogue: "",
    };
  }
  preview(source: string, id?: string): CardPreview {
    if (id && !this.entries.has(id))
      throw new ConnectionError("card", "角色不存在，请重新加载。");
    const result = parse(source);
    const token = randomUUID();
    this.pending = {
      token,
      source,
      persona: result.persona,
      ...(id ? { id } : {}),
    };
    return { token, persona: result.persona, warnings: result.warnings };
  }
  editPreview(id: unknown, fields: unknown): CardPreview {
    if (
      typeof id !== "string" ||
      !fields ||
      typeof fields !== "object" ||
      Object.keys(fields).length !== 6 ||
      Object.keys(fields).some((key) => !Object.hasOwn(fieldNames, key))
    )
      throw new ConnectionError("card", "角色字段格式不正确。");
    const edit = fields as CardFields;
    if (Object.values(edit).some((value) => typeof value !== "string"))
      throw new ConnectionError("card", "角色字段须为文字。");
    const entry = this.entries.get(id);
    let root: Record<string, unknown>;
    if (entry) root = JSON.parse(entry.source);
    else {
      if (!getCharacter(id) && id !== "new")
        throw new ConnectionError("card", "角色不存在。");
      root = {};
    }
    const target =
      root.spec === "chara_card_v2"
        ? (root.data as Record<string, unknown>)
        : root;
    for (const [key, sourceKey] of Object.entries(fieldNames))
      target[sourceKey] = edit[key as keyof CardFields];
    return this.preview(JSON.stringify(root, null, 2), entry ? id : undefined);
  }
  commit(token: unknown, acknowledged: unknown): string {
    if (
      typeof token !== "string" ||
      acknowledged !== true ||
      !this.pending ||
      this.pending.token !== token
    )
      throw new ConnectionError("card", "请先检查角色预览，再确认保存。");
    const pending = this.pending;
    const id = pending.id ?? `card-${randomUUID()}`;
    if (!pending.id && this.entries.size >= 20)
      throw new ConnectionError(
        "card",
        "最多保留 20 个自定义角色，请删除暂时不用的角色后再试。",
      );
    mkdirSync(this.directory, { recursive: true });
    const file = this.file(id);
    if (pending.id) {
      const current = this.read(id);
      if (current !== this.entries.get(id)?.source)
        throw new ConnectionError(
          "card",
          "角色文件已在外部修改，请重新加载再编辑。",
        );
      const backup = join(this.directory, "backups");
      mkdirSync(backup, { recursive: true });
      writeFileSync(join(backup, `${id}.${Date.now()}.json`), current, {
        mode: 0o600,
      });
      for (const old of readdirSync(backup)
        .filter((name) => name.startsWith(id + "."))
        .sort()
        .slice(0, -5))
        rmSync(join(backup, old));
    }
    writeFileSync(file + ".tmp", pending.source, { mode: 0o600 });
    renameSync(file + ".tmp", file);
    this.entries.set(id, { source: pending.source, persona: pending.persona });
    this.pending = undefined;
    return id;
  }
  cancel() {
    this.pending = undefined;
  }
  original(id: unknown) {
    if (typeof id !== "string" || !this.entries.has(id))
      throw new ConnectionError("card", "只能导出自定义角色。");
    return this.read(id);
  }
  delete(id: unknown) {
    if (typeof id !== "string" || !this.entries.has(id))
      throw new ConnectionError("card", "只能删除自定义角色。");
    rmSync(this.file(id));
    this.entries.delete(id);
    this.pending = undefined;
  }
  clear() {
    rmSync(this.directory, { recursive: true, force: true });
    this.entries.clear();
    this.pending = undefined;
  }
}
