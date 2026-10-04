import {
  createProvider,
  LIVE_MODEL,
  readProviderKey,
} from "../server/provider.js";
import type { ChatRequest } from "../shared/characters.js";

// Explicitly authorized manual check only; npm test never imports this file.
if (process.env.QIBAN_LIVE_SMOKE_AUTHORIZED !== "yes") {
  console.error(
    "Blocked: confirm secure setup and paid-test authorization before setting QIBAN_LIVE_SMOKE_AUTHORIZED=yes.",
  );
  process.exit(2);
}
const apiKey = readProviderKey(process.env);
if (!apiKey) {
  console.error(
    "Blocked: DEEPSEEK_API_KEY or deepseek binding is unavailable. Republish the environment and start a fresh task.",
  );
  process.exit(2);
}
const provider = createProvider({
  mode: "live",
  apiKey,
});
try {
  const first: ChatRequest = {
    characterId: "lin",
    messages: [
      {
        role: "user",
        content: "今天散步看到一只白色的小鸟，心情很好。你喜欢散步吗？",
      },
    ],
  };
  const answer = await provider.reply(first);
  console.log(
    JSON.stringify({
      check: "human persona",
      model: LIVE_MODEL,
      content: answer,
    }),
  );
  const followup: ChatRequest = {
    characterId: "lin",
    messages: [
      ...first.messages,
      { role: "assistant", content: answer },
      { role: "user", content: "我刚才看到的小鸟是什么颜色？只回答颜色。" },
    ],
  };
  console.log(
    JSON.stringify({
      check: "recent context",
      model: LIVE_MODEL,
      content: await provider.reply(followup),
    }),
  );
  console.log(
    JSON.stringify({
      check: "pet persona",
      model: LIVE_MODEL,
      content: await provider.reply({
        characterId: "dou",
        messages: [
          {
            role: "user",
            content: "豆包，你是一只什么样的小狗？今天想玩什么？",
          },
        ],
      }),
    }),
  );
  console.log(
    "Completed: exactly 3 synthetic calls, at most 768 output tokens total, no retries. Review replies manually for personality and context.",
  );
} catch {
  console.error(
    "Live smoke stopped after a failed call; no retries. Authentication or provider response was not usable.",
  );
  process.exitCode = 1;
} finally {
  await provider.close?.();
}
