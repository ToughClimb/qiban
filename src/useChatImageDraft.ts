import { useEffect, useRef, useState } from "react";
import { isChatImageAttachment, type ChatImageAttachment, type ChatImageDraft } from "../shared/image-chat";
import { desktopBridge } from "./api";
import { safeChatImagePreview } from "./chatImageUrl";

type OwnedDraft = ChatImageDraft & { characterId: string; discardable: boolean };
const MISSING_IMAGE_NOTICE = "原图片无法读取，已从编辑草稿移除。可以发送文字或重新选图。";
export function useChatImageDraft(characterId: string) {
  const [draft, setDraft] = useState<OwnedDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const staged = useRef<OwnedDraft | null>(null);
  const epoch = useRef(0);
  const currentCharacter = useRef(characterId);
  const mounted = useRef(true);

  async function discard(value: OwnedDraft, token: number) {
    try {
      const result = await desktopBridge()?.discardChatImage?.(value.characterId, value.image.id);
      if ((!result || !result.ok) && mounted.current && token === epoch.current && value.characterId === currentCharacter.current)
        setError("图片未能清理，请稍后重试。");
    } catch {
      if (mounted.current && token === epoch.current && value.characterId === currentCharacter.current)
        setError("图片未能清理，请稍后重试。");
    }
  }
  function clear() {
    const value = staged.current;
    const token = ++epoch.current;
    staged.current = null;
    setDraft(null); setPicking(false); setError("");
    if (value?.discardable) void discard(value, token);
  }
  useEffect(() => {
    currentCharacter.current = characterId;
    clear();
  }, [characterId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const value = staged.current;
      staged.current = null;
      const token = ++epoch.current;
      if (value?.discardable) void discard(value, token);
    };
  }, []);

  async function pick() {
    const bridge = desktopBridge();
    if (!bridge?.pickChatImage || !bridge.chatImagePreview || !bridge.discardChatImage) {
      setError("当前平台暂不支持发送图片。");
      return;
    }
    if (staged.current || picking) return;
    const token = ++epoch.current;
    const id = characterId;
    setPicking(true); setError("");
    try {
      const result = await bridge.pickChatImage(id);
      if (!result.ok) {
        if (token === epoch.current && mounted.current) setError(result.error);
        return;
      }
      if (!result.value) return;
      const value = { ...result.value, characterId: id, discardable: true };
      if (token !== epoch.current || id !== currentCharacter.current || !mounted.current) {
        if (isChatImageAttachment(value.image)) void discard(value, token);
        return;
      }
      const url = safeChatImagePreview(value.previewUrl);
      if (!isChatImageAttachment(value.image) || !url) {
        if (isChatImageAttachment(value.image)) void discard(value, token);
        setError("图片无法显示，请重新选择。");
        return;
      }
      staged.current = { ...value, previewUrl: url };
      setDraft(staged.current);
    } catch {
      if (token === epoch.current && mounted.current)
        setError("图片未能添加，请重试。");
    } finally {
      if (token === epoch.current && mounted.current) setPicking(false);
    }
  }
  async function restore(image: ChatImageAttachment): Promise<"restored" | "missing" | "cancelled"> {
    const token = ++epoch.current;
    setPicking(true); setError("");
    try {
      const result = await desktopBridge()?.chatImagePreview?.(characterId, image.id);
      if (token !== epoch.current || characterId !== currentCharacter.current || !mounted.current) return "cancelled";
      const url = result?.ok ? safeChatImagePreview(result.value) : null;
      if (!url) {
        setError(MISSING_IMAGE_NOTICE);
        return "missing";
      }
      // Keep the pending history reference until Send; this is not a new local file.
      staged.current = { characterId, image, previewUrl: url, discardable: false };
      setDraft(staged.current);
      return "restored";
    } catch {
      if (token !== epoch.current || characterId !== currentCharacter.current || !mounted.current) return "cancelled";
      setError(MISSING_IMAGE_NOTICE);
      return "missing";
    } finally {
      if (token === epoch.current && mounted.current) setPicking(false);
    }
  }
  function take() {
    // Send transfers the opaque reference to history; its preview stays transient.
    const image = staged.current?.image;
    staged.current = null;
    ++epoch.current;
    setDraft(null); setError("");
    return image;
  }
  function failPreview() {
    clear();
    setError("图片无法显示，请重新选择。");
  }
  return { draft: draft?.characterId === characterId ? draft : null, picking, error, pick, clear, restore, take, failPreview };
}
