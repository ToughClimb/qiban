import { MAX_HISTORY, type ChatRequest } from "./characters.js";

export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_REQUEST_BYTES = 48 * 1024;
const encoder = new TextEncoder();
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}
export function fitsChatBudget(request: ChatRequest): boolean {
  return (
    request.messages.reduce(
      (sum, message) => sum + utf8Bytes(message.content),
      0,
    ) <= MAX_CONTEXT_BYTES &&
    utf8Bytes(JSON.stringify(request)) <= MAX_REQUEST_BYTES
  );
}
export function trimChatContext(request: ChatRequest): ChatRequest {
  let messages = request.messages.slice(-(MAX_HISTORY - 1));
  if (messages[0]?.role === "assistant") messages = messages.slice(1);
  let recent = { ...request, messages };
  // Drop complete old turns; retain the latest user message for sending or editing.
  while (!fitsChatBudget(recent) && recent.messages.length > 1) {
    recent = { ...recent, messages: recent.messages.slice(2) };
  }
  return recent;
}
