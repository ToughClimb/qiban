import { useEffect, useState } from "react";
import type { ChatImageAttachment } from "../shared/image-chat";
import { desktopBridge } from "./api";
import { safeChatImagePreview } from "./chatImageUrl";

export function ChatImagePreview({ characterId, image, omitted = false }: {
  characterId: string;
  image: ChatImageAttachment;
  omitted?: boolean;
}) {
  const [preview, setPreview] = useState<{ key: string; url: string | null; error: string }>();
  const key = `${characterId}/${image.id}`;
  useEffect(() => {
    let cancelled = false;
    const resolve = desktopBridge()?.chatImagePreview;
    if (!resolve) {
      setPreview({ key, url: null, error: "当前平台无法显示这张图片。" });
      return;
    }
    resolve(characterId, image.id).then((result) => {
      if (cancelled) return;
      const url = result.ok ? safeChatImagePreview(result.value) : null;
      setPreview({ key, url, error: url ? "" : "图片无法显示。" });
    }).catch(() => {
      if (!cancelled) setPreview({ key, url: null, error: "图片无法显示。" });
    });
    return () => { cancelled = true; };
  }, [key, characterId, image.id]);
  const current = preview?.key === key ? preview : undefined;
  return (
    <figure className="chat-image" data-image-id={image.id}>
      {current?.url ? (
        <img src={current.url} alt="发送的图片" loading="lazy"
          onError={() => setPreview({ key, url: null, error: "图片无法显示。" })} />
      ) : <span className="image-placeholder">{current?.error || "正在读取图片…"}</span>}
      {omitted && <figcaption>本次回复未读取这张图片。</figcaption>}
    </figure>
  );
}
