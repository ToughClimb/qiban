import { MAX_CHAT_IMAGE_BYTES } from "../shared/image-chat";

// Previews come only from the typed local bridge, never from card/history URLs.
export function safeChatImagePreview(value: unknown): string | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 40)
    return null;
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) return null;
  const padding = match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0;
  return match[1].length / 4 * 3 - padding <= MAX_CHAT_IMAGE_BYTES ? value : null;
}
