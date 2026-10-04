import { Capacitor, registerPlugin } from "@capacitor/core";
import type {
  DesktopBridge,
  ConnectionStatus,
  Result,
} from "../../shared/desktop";
import {
  characters,
  getCharacter,
  type ChatRequest,
  type Character,
} from "../../shared/characters";
import {
  cardFields,
  type CardFields,
  type CardPreview,
} from "../../shared/cards";
import { parseCharacterCard } from "../../shared/character-card";
import type { Conversations } from "../../shared/history";
import { personalities } from "../../server/personas";

type NativeCards = { cards: { id: string; raw: string }[]; issues: string[] };
export interface AndroidPlugin {
  status(): Promise<Result<ConnectionStatus>>;
  connect(input: {
    baseUrl: string;
    remember: boolean;
    promptForKey: boolean;
  }): Promise<Result<ConnectionStatus>>;
  selectModel(input: { model: string }): Promise<Result<ConnectionStatus>>;
  demo(): Promise<Result<ConnectionStatus>>;
  deleteKey(): Promise<Result<ConnectionStatus>>;
  deleteData(): Promise<Result<void>>;
  listCards(): Promise<Result<NativeCards>>;
  importCard(): Promise<Result<{ raw: string } | null>>;
  saveCard(input: { id?: string; raw: string }): Promise<Result<string>>;
  deleteCard(input: { id: string }): Promise<Result<void>>;
  exportCard(input: { id: string }): Promise<Result<void>>;
  openCards(): Promise<Result<void>>;
  loadHistory(): Promise<Result<Conversations>>;
  saveHistory(input: { history: Conversations }): Promise<Result<void>>;
  dataPath(): Promise<Result<string>>;
  diagnostics(): Promise<Result<Record<string, string | number | boolean>>>;
  chat(input: {
    request: ChatRequest;
    persona: CardFields;
    id: string;
  }): Promise<Result<{ content: string; mode: "demo" | "live" }>>;
  cancel(input: { id: string }): Promise<Result<void>>;
}
declare global {
  interface Window {
    qibanPlatform?: "android";
    qibanAndroid?: AndroidPlugin;
  }
}
const failure = <T>(error: string): Result<T> => ({ ok: false, error });
const customId =
  /^card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sourceNames: Record<keyof CardFields, string> = {
  name: "name",
  description: "description",
  personality: "personality",
  scenario: "scenario",
  firstMessage: "first_mes",
  exampleDialogue: "mes_example",
};

/** Fixed operations only; raw sources are retained separately from runtime personas. */
export function createAndroidBridge(native: AndroidPlugin): DesktopBridge {
  const sources = new Map<string, string>();
  let pending:
    | {
        token: string;
        raw: string;
        id?: string;
        previous?: string;
        preview: CardPreview;
      }
    | undefined;
  const builtinFields = (id: string): CardFields | undefined => {
    const character = getCharacter(id);
    return (
      character && {
        name: character.name,
        description: character.description,
        personality: personalities[id],
        scenario: "",
        firstMessage: character.greeting,
        exampleDialogue: "",
      }
    );
  };
  async function reload() {
    const result = await native.listCards();
    if (!result.ok) return result;
    if (result.value.cards.length > 100)
      return failure<NativeCards>("角色数量超过本版限制。");
    sources.clear();
    for (const item of result.value.cards) {
      if (customId.test(item.id) && parseCharacterCard(item.raw).ok)
        sources.set(item.id, item.raw);
    }
    return result;
  }
  function preview(
    raw: string,
    id?: string,
    previous?: string,
  ): Result<CardPreview> {
    const parsed = parseCharacterCard(raw);
    if (!parsed.ok)
      return failure(
        "角色格式不符合要求，或内容超过大小限制。请检查 JSON 文件。",
      );
    const token = crypto.randomUUID();
    const value = { token, persona: parsed.persona, warnings: parsed.warnings };
    pending = { token, raw, id, previous, preview: value };
    return { ok: true, value };
  }
  async function fields(id: string): Promise<Result<CardFields>> {
    const builtin = builtinFields(id);
    if (builtin) return { ok: true, value: builtin };
    const result = await reload();
    if (!result.ok) return result;
    const raw = sources.get(id);
    const parsed = raw && parseCharacterCard(raw);
    return parsed && parsed.ok
      ? { ok: true, value: cardFields(parsed.persona) }
      : failure("这个角色无法读取，请重新加载。");
  }
  return {
    async cards() {
      const result = await reload();
      if (!result.ok) return result;
      const list: Character[] = [...characters];
      for (const [id, raw] of sources) {
        const parsed = parseCharacterCard(raw);
        if (!parsed.ok) continue;
        const persona = parsed.persona;
        list.push({
          id,
          name: persona.name,
          kind: "虚拟角色",
          emoji: "✦",
          color: "sage",
          role: "原创伙伴",
          description: persona.personality || "一位虚拟的聊天伙伴",
          greeting: persona.firstMessage || "你好，今天想聊点什么？",
          starters: ["今天过得怎么样？", "聊一件小事"],
        });
      }
      return {
        ok: true,
        value: {
          characters: list,
          issues: [
            ...result.value.issues,
            ...(sources.size < result.value.cards.length
              ? ["部分角色文件无法读取，请检查文件格式。"]
              : []),
          ],
        },
      };
    },
    async importCard() {
      pending = undefined;
      const result = await native.importCard();
      if (!result.ok) return result;
      if (result.value === null) return { ok: true, value: null };
      return preview(result.value.raw);
    },
    editFields: fields,
    async previewCard(id, edits) {
      pending = undefined;
      if (
        Object.keys(edits).length !== 6 ||
        Object.keys(edits).some((key) => !Object.hasOwn(sourceNames, key))
      )
        return failure("角色设定格式不正确。");
      let previous: string | undefined;
      if (customId.test(id)) {
        const result = await reload();
        if (!result.ok) return result;
        previous = sources.get(id);
        if (!previous) return failure("这个角色无法读取，请重新加载。");
      } else if (id !== "new" && !getCharacter(id))
        return failure("找不到这个角色。");
      const raw = previous ? JSON.parse(previous) : {};
      const target = raw.spec === "chara_card_v2" ? raw.data : raw;
      for (const [key, source] of Object.entries(sourceNames))
        target[source] = edits[key as keyof CardFields];
      return preview(
        JSON.stringify(raw, null, 2),
        previous ? id : undefined,
        previous,
      );
    },
    async saveCard(token, acknowledged) {
      const candidate = pending;
      if (!candidate || candidate.token !== token || !acknowledged)
        return failure("请先检查角色设定和不支持的内容，再确认保存。");
      if (candidate.id) {
        const result = await reload();
        if (!result.ok) return result;
        if (sources.get(candidate.id) !== candidate.previous) {
          pending = undefined;
          return failure("角色文件已变化，请重新检查设定。");
        }
      }
      const result = await native.saveCard({
        ...(candidate.id ? { id: candidate.id } : {}),
        raw: candidate.raw,
      });
      if (result.ok) {
        pending = undefined;
        sources.set(result.value, candidate.raw);
      }
      return result;
    },
    async cancelCard() {
      pending = undefined;
      return { ok: true, value: undefined };
    },
    exportCard: (id) => native.exportCard({ id }),
    deleteCard: (id) => native.deleteCard({ id }),
    openCards: () => native.openCards(),
    loadHistory: () => native.loadHistory(),
    saveHistory: (history) => native.saveHistory({ history }),
    dataPath: () => native.dataPath(),
    diagnostics: () => native.diagnostics(),
    status: () => native.status(),
    // A compatibility call may reuse a native key, but never accept one from JS.
    connect: (input) =>
      input.apiKey
        ? Promise.resolve(failure("请在手机的连接对话框中输入密钥。"))
        : native.connect({
            baseUrl: input.baseUrl,
            remember: input.remember,
            promptForKey: false,
          }),
    selectModel: (model) => native.selectModel({ model }),
    demo: () => native.demo(),
    deleteKey: () => native.deleteKey(),
    async deleteData() {
      pending = undefined;
      sources.clear();
      return native.deleteData();
    },
    async chat(request, id) {
      const result = await fields(request.characterId);
      if (!result.ok) return result;
      return native.chat({ request, persona: result.value, id });
    },
    cancel(id) {
      void native.cancel({ id }).catch(() => {});
    },
  };
}

export function initializeAndroid(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android")
    return;
  const native = registerPlugin<AndroidPlugin>("Qiban");
  window.qibanPlatform = "android";
  document.documentElement.dataset.qibanPlatform = "android";
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute(
    "content",
    "width=device-width, initial-scale=1.0, viewport-fit=cover",
  );
  window.qibanAndroid = native;
  window.qiban = createAndroidBridge(native);
}
