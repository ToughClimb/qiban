// Opt-in, exactly one paid inference request; never runs in CI or retries.
import { requestJson } from "../desktop/network.js";
import { modelRequest, finalText, LIVE_MODEL } from "../server/model.js";
import { readProviderKey } from "../server/provider.js";
const allowed = process.env.QIBAN_ALLOW_ONE_NATIVE_LIVE_CHECK === "1";
const key = readProviderKey(process.env);
if (!allowed || !key) {
  console.error(
    "BLOCKED: explicit one-request authorization and a securely injected provider credential are required. Do not enter a key in chat or commit it.",
  );
  process.exitCode = 2;
} else {
  try {
    const body = modelRequest(
      {
        characterId: "lin",
        messages: [
          {
            role: "user",
            content: "这是一条合成连通性测试，请用一句话描述河边的风。",
          },
        ],
      },
      LIVE_MODEL,
      true,
    );
    body.max_tokens = 32;
    const result = await requestJson(
      new URL("https://api.deepseek.com/chat/completions"),
      key,
      body,
    );
    const content = finalText(result);
    const usage = (
      result as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }
    ).usage;
    console.log(
      JSON.stringify({
        native_inference: "passed",
        provider: "DeepSeek",
        final_text_received: Boolean(content),
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        request_count: 1,
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        native_inference: "failed",
        request_count_at_most: 1,
        retries: 0,
      }),
    );
    process.exitCode = 1;
  }
}
