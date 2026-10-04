import { getCharacter, type CharacterId, type Message } from "./characters.js";
export const STORAGE_KEY = "qiban.conversations.v1";
export type Conversations = Partial<Record<CharacterId, Message[]>>;
export function readConversations(storage: {
  getItem(key: string): string | null;
}): Conversations {
  try {
    const data: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const result: Conversations = {};
    for (const [id, messages] of Object.entries(data)) {
      if (
        (!getCharacter(id) && !/^card-[a-f0-9-]{36}$/.test(id)) ||
        !Array.isArray(messages)
      )
        continue;
      if (
        messages.length <= 200 &&
        messages.every(
          (message, index) =>
            message &&
            typeof message.id === "string" &&
            message.role === (index % 2 === 0 ? "user" : "assistant") &&
            typeof message.content === "string" &&
            message.content.length > 0 &&
            message.content.length <= 8000 &&
            (message.mode === undefined ||
              (message.role === "assistant" &&
                ["demo", "live"].includes(message.mode))),
        )
      ) {
        result[id as CharacterId] = messages;
      }
    }
    return result;
  } catch {
    return {};
  }
}
export function writeConversations(
  storage: { setItem(key: string, value: string): void },
  data: Conversations,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function replaceConversation(
  data: Conversations,
  id: CharacterId,
  messages: Message[],
): Conversations {
  return { ...data, [id]: messages.slice(messages.length % 2 ? -199 : -200) };
}
export function resetConversation(
  data: Conversations,
  id: CharacterId,
): Conversations {
  const next = { ...data };
  delete next[id];
  return next;
}
