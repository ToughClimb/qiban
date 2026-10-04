import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { ChatRequest } from "../shared/characters.js";
import type { ChatImageResolver } from "./image-chat.js";
import { prepareImageModelRequest, finalText, LIVE_MODEL } from "./model.js";
export { LIVE_MODEL, MAX_OUTPUT_TOKENS } from "./model.js";

export type Mode = "demo" | "live";
export type Config = { mode: Mode; apiKey?: string; accessToken?: string };
export type Provider = {
  reply(request: ChatRequest, signal?: AbortSignal): Promise<string>;
  close?(): Promise<void>;
};
export function readProviderKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.DEEPSEEK_API_KEY || env.deepseek;
}
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const apiKey = readProviderKey(env);
  const mode = env.QIBAN_MODE ?? "demo";
  if (mode !== "demo" && mode !== "live")
    throw new Error("QIBAN_MODE must be demo or live");
  if (
    mode === "live" &&
    (!apiKey || (env.QIBAN_ACCESS_TOKEN?.length ?? 0) < 24)
  ) {
    throw new Error(
      "Live mode requires DEEPSEEK_API_KEY (or deepseek) and QIBAN_ACCESS_TOKEN (24+ characters)",
    );
  }
  return {
    mode,
    apiKey,
    accessToken: env.QIBAN_ACCESS_TOKEN,
  };
}

function demoReply({ characterId, messages }: ChatRequest): string {
  const last = messages.at(-1)!.content;
  const tired = /累|难过|烦|放松|安静/.test(last);
  const replies: Record<string, string> = {
    lin: tired
      ? "那就先歇一歇。我会想象我们坐在河边，听一会儿风。你想说说发生了什么，还是聊点轻松的？"
      : "散步时我发现，熟悉的小路也会冒出新鲜的细节。你今天有没有留意到一件小事？",
    tao: tired
      ? "今天不必非得有个漂亮的结尾。我们可以先放下待办。你想让我听你说，还是一起想件小小的开心事？"
      : "我想画一家只在雨天营业的小店，门口放着橘色的伞。你会给它起什么名字？",
    dou: tired
      ? "汪，我趴下来陪你歇一会儿。我的球可以等一等。要不要一起伸个懒腰？"
      : "汪！我今天追了一片会翻跟头的叶子，结果它跑得比球还快。你今天有什么新发现？",
    moon: tired
      ? "喵，那就先靠着软垫坐一会儿。不说话也可以。我在窗边看一片慢悠悠的云。"
      : "今天一只麻雀来窗外串门，我假装没看见它，尾巴却暴露了。喵，你那边有什么小趣事？",
  };
  return (
    replies[characterId] ??
    "这里是演示聊天的预设示例。连接 AI 服务后，角色会根据你写的设定来回应。今天想聊些什么？"
  );
}

export type ProviderFetch = (
  url: string,
  options: {
    method: string;
    redirect: "error";
    signal: AbortSignal;
    dispatcher: EnvHttpProxyAgent;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
  body?: { cancel(): Promise<void> } | null;
}>;
// Fetch and dispatcher must come from the same Undici implementation.
export const providerFetch: ProviderFetch = (url, options) =>
  undiciFetch(url, options);
export function createProvider(
  config: Config,
  fetcher: ProviderFetch = providerFetch,
  resolveImage?: ChatImageResolver,
): Provider {
  if (config.mode === "demo")
    return { reply: async (request) => {
      if (request.messages.some(message => message.image || message.imageOmitted))
        throw new Error("Image attachments are unavailable in demo mode");
      return demoReply(request);
    } };
  // Cloud network secrets are substituted by the HTTPS proxy. Never bypass it.
  const dispatcher = new EnvHttpProxyAgent();
  return {
    close: () => dispatcher.close(),
    async reply(request, signal) {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
        : AbortSignal.timeout(25_000);
      const { body } = await prepareImageModelRequest(request, LIVE_MODEL, true, undefined, resolveImage, requestSignal);
      const options = {
        method: "POST",
        redirect: "error" as const,
        signal: requestSignal,
        dispatcher,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      };
      const response = await fetcher(
        "https://api.deepseek.com/chat/completions",
        options,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Provider unavailable");
      }
      return finalText(await response.json());
    },
  };
}
