import {
  getCharacter,
  MAX_HISTORY,
  MAX_MESSAGE_LENGTH,
  type ChatRequest,
} from "../shared/characters.js";
export function parseChat(value: unknown): ChatRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["characterId", "messages"].includes(key),
    ) ||
    typeof body.characterId !== "string" ||
    !getCharacter(body.characterId)
  )
    return null;
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > MAX_HISTORY
  )
    return null;
  let total = 0;
  for (const [index, message] of body.messages.entries()) {
    if (
      !message ||
      typeof message !== "object" ||
      Object.keys(message).some((key) => !["role", "content"].includes(key))
    )
      return null;
    if (
      message.role !== (index % 2 === 0 ? "user" : "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length >
        (message.role === "user" ? MAX_MESSAGE_LENGTH : 8000)
    )
      return null;
    total += message.content.length;
  }
  if (total > 32_000 || body.messages.at(-1).role !== "user") return null;
  return body as ChatRequest;
}
