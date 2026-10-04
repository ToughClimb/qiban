import type { DesktopBridge, ChatReply } from "../shared/desktop";
import {
  MAX_MESSAGE_LENGTH,
  type Mode,
  type CharacterId,
  type Message,
} from "../shared/characters";
import { fitsChatBudget, prepareChatContext } from "../shared/chat";
export type { Mode } from "../shared/characters";
export type { ChatReply } from "../shared/desktop";
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.qiban;
}
export async function readMode(signal: AbortSignal): Promise<Mode> {
  const bridge = desktopBridge();
  if (bridge) {
    const result = await bridge.status();
    if (!result.ok) throw new ChatError(result.error);
    return result.value.mode;
  }
  const response = await fetch("/api/config", { signal });
  if (!response.ok) throw new ChatError("暂时连接不上栖伴。");
  const data = await response.json();
  if (data.mode !== "demo" && data.mode !== "live")
    throw new ChatError("连接信息未能读取。");
  return data.mode;
}
export class ChatError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
export async function sendMessage(
  characterId: CharacterId,
  messages: Message[],
  accessToken: string,
  signal: AbortSignal,
): Promise<ChatReply> {
  const { request, omittedImageIds } = prepareChatContext({
    characterId,
    messages: messages.map(({ role, content, image }) => ({
      role, content, ...(image === undefined ? {} : { image }),
    })),
  });
  if (
    !fitsChatBudget(request) ||
    (request.messages.at(-1)?.content.length ?? 0) > MAX_MESSAGE_LENGTH
  ) {
    throw new ChatError("消息太长，请编辑这条消息后再发送。", 413);
  }
  const withOmissions = (reply: ChatReply): ChatReply => {
    const omitted = [...new Set([...omittedImageIds, ...(reply.omittedImageIds ?? [])])];
    return {
      content: reply.content,
      mode: reply.mode,
      ...(omitted.length ? { omittedImageIds: omitted } : {}),
    };
  };
  const bridge = desktopBridge();
  if (bridge) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const id = crypto.randomUUID();
    const onAbort = () => bridge.cancel(id);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await bridge.chat(request, id);
      if (!result.ok) throw new ChatError(result.error);
      return withOmissions(result.value);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  const response = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const safeErrors: Record<number, string> = {
      401: "体验口令不正确，请重新输入。",
      429: "消息有点多，请稍等一分钟再试。",
      400: "消息太长或格式不正确，请缩短后再试。",
      413: "消息太长，请编辑这条消息后再发送。",
    };
    throw new ChatError(
      safeErrors[response.status] ??
        "这次没能收到回复。你的消息还在，可以再试一次。",
      response.status,
    );
  }
  const data = await response.json();
  if (
    typeof data.content !== "string" ||
    !data.content.trim() ||
    data.content.length > 8000 ||
    (data.mode !== "demo" && data.mode !== "live")
  )
    throw new ChatError("回复没有送达，请再试一次。");
  return withOmissions({ content: data.content, mode: data.mode });
}
