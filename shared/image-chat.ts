// Persist references only. Previews and encoded image bytes never belong in history.
export const MAX_CHAT_IMAGE_BYTES = 1024 * 1024;
export const MAX_CHAT_IMAGE_EDGE = 1600;
export const MAX_CONTEXT_IMAGES = 3;
export const MAX_CONTEXT_IMAGE_BYTES = MAX_CONTEXT_IMAGES * MAX_CHAT_IMAGE_BYTES;
export const CHAT_IMAGE_ID = /^image-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type ChatImageMime = "image/jpeg" | "image/png" | "image/webp";
export type ChatImageAttachment = {
  id: string;
  mimeType: ChatImageMime;
  byteLength: number;
  width: number;
  height: number;
};
export type ChatImageDraft = { image: ChatImageAttachment; previewUrl: string };
export function isChatImageAttachment(value: unknown): value is ChatImageAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  return Object.keys(image).length === 5 &&
    Object.keys(image).every(key => ["id", "mimeType", "byteLength", "width", "height"].includes(key)) &&
    typeof image.id === "string" && CHAT_IMAGE_ID.test(image.id) &&
    ["image/jpeg", "image/png", "image/webp"].includes(image.mimeType as string) &&
    [image.byteLength, image.width, image.height].every(n => Number.isSafeInteger(n) && (n as number) > 0) &&
    (image.byteLength as number) <= MAX_CHAT_IMAGE_BYTES &&
    (image.width as number) <= MAX_CHAT_IMAGE_EDGE &&
    (image.height as number) <= MAX_CHAT_IMAGE_EDGE;
}
// Native stores can compare history references to draft/stored files for local cleanup.
export function chatImageIds(messages: readonly { image?: ChatImageAttachment }[]): string[] {
  return [...new Set(messages.flatMap(message => message.image ? [message.image.id] : []))];
}
