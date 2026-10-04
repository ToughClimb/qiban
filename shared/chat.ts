import { MAX_CONTEXT_IMAGES, MAX_CONTEXT_IMAGE_BYTES, isChatImageAttachment } from "./image-chat.js";
import { MAX_HISTORY, type ChatRequest } from "./characters.js";

export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_REQUEST_BYTES = 48 * 1024;
const encoder = new TextEncoder();
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}
export function fitsChatBudget(request: ChatRequest): boolean {
  const images = request.messages.flatMap(message => message.image ? [message.image] : []);
  return (
    images.length <= MAX_CONTEXT_IMAGES &&
    images.every(isChatImageAttachment) &&
    images.reduce((sum, image) => sum + image.byteLength, 0) <= MAX_CONTEXT_IMAGE_BYTES &&
    request.messages.reduce(
      (sum, message) => sum + utf8Bytes(message.content),
      0,
    ) <= MAX_CONTEXT_BYTES &&
    utf8Bytes(JSON.stringify(request)) <= MAX_REQUEST_BYTES
  );
}
export function prepareChatContext(request: ChatRequest): { request: ChatRequest; omittedImageIds: string[] } {
  for (const message of request.messages) {
    if (Object.hasOwn(message, "image") && (!isChatImageAttachment(message.image) || message.role !== "user" || message.imageOmitted))
      throw new Error("Invalid image attachment");
    if (Object.hasOwn(message, "imageOmitted") && (message.imageOmitted !== true || message.role !== "user"))
      throw new Error("Invalid image omission marker");
  }
  const allImages = request.messages.flatMap(message => message.image ? [message.image.id] : []);
  let messages = request.messages.slice(-(MAX_HISTORY - 1));
  if (messages[0]?.role === "assistant") messages = messages.slice(1);
  let remaining = MAX_CONTEXT_IMAGES;
  messages = messages.map(message => ({ ...message }));
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message.image) continue;
    if (!isChatImageAttachment(message.image) || message.role !== "user" || message.imageOmitted)
      throw new Error("Invalid image attachment");
    if (remaining-- <= 0) {
      delete message.image;
      message.imageOmitted = true;
    }
  }
  let recent = { ...request, messages };
  // Drop complete old turns; retain the latest user message for sending or editing.
  while (!fitsChatBudget(recent) && recent.messages.length > 1) {
    recent = { ...recent, messages: recent.messages.slice(2) };
  }
  const retained = new Set(recent.messages.flatMap(message => message.image ? [message.image.id] : []));
  return { request: recent, omittedImageIds: [...new Set(allImages.filter(id => !retained.has(id)))] };
}

export function trimChatContext(request: ChatRequest): ChatRequest {
  return prepareChatContext(request).request;
}
