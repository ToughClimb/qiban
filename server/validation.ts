import {
  getCharacter,
  MAX_HISTORY,
  MAX_MESSAGE_LENGTH,
  type ChatRequest,
} from "../shared/characters.js";
import { fitsChatBudget } from "../shared/chat.js";
export function parseChat(
  value: unknown,
  known: (id: string) => boolean = (id) => Boolean(getCharacter(id)),
): ChatRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["characterId", "messages"].includes(key),
    ) ||
    typeof body.characterId !== "string" ||
    !known(body.characterId)
  )
    return null;
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > MAX_HISTORY
  )
    return null;
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
  }
  if (body.messages.at(-1).role !== "user") return null;
  const request = body as ChatRequest;
  return fitsChatBudget(request) ? request : null;
}
