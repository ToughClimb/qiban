import {
  MAX_MESSAGE_LENGTH,
  type Mode,
  type CharacterId,
  type Message,
} from "../shared/characters";
import { fitsChatBudget, trimChatContext } from "../shared/chat";
export type { Mode } from "../shared/characters";
export type ChatReply = { content: string; mode: Mode };
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
  const request = trimChatContext({
    characterId,
    messages: messages.map(({ role, content }) => ({ role, content })),
  });
  if (
    !fitsChatBudget(request) ||
    (request.messages.at(-1)?.content.length ?? 0) > MAX_MESSAGE_LENGTH
  ) {
    throw new ChatError("消息太长，请编辑这条消息后再发送。", 413);
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
  return { content: data.content, mode: data.mode };
}
