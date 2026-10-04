import {
  MAX_HISTORY,
  type CharacterId,
  type Message,
} from "../shared/characters";
export type Mode = "demo" | "live";
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
): Promise<string> {
  // Keep complete recent turns, starting with a user message.
  const start = Math.max(0, messages.length - (MAX_HISTORY - 1));
  let recent = messages.slice(start);
  if (recent[0]?.role === "assistant") recent = recent.slice(1);
  while (
    recent.reduce((sum, message) => sum + message.content.length, 0) > 32_000 &&
    recent.length > 1
  )
    recent = recent.slice(2);
  const response = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      characterId,
      messages: recent.map(({ role, content }) => ({ role, content })),
    }),
  });
  if (!response.ok) {
    const safeErrors: Record<number, string> = {
      401: "体验口令不正确，请重新输入。",
      429: "消息有点多，请稍等一分钟再试。",
      400: "消息太长或格式不正确，请缩短后再试。",
      413: "消息太长，请缩短后再试。",
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
    data.content.length > 8000
  )
    throw new ChatError("回复没有送达，请再试一次。");
  return data.content;
}
