// One unpaid request with an explicitly synthetic key. Never reads provider credentials.
import { requestJson, ConnectionError } from "../desktop/network.js";
try {
  const result = await requestJson(
    new URL("https://api.deepseek.com/models"),
    "synthetic-native-reachability-key",
  );
  if (!result || typeof result !== "object")
    throw new Error("Unexpected native provider response");
  console.log(
    "PASS native production HTTPS transport reached DeepSeek /models and parsed JSON; synthetic key only, no inference request.",
  );
} catch (error) {
  if (error instanceof ConnectionError && error.code === "auth") {
    console.log(
      "PASS native production HTTPS transport reached DeepSeek /models and handled rejected synthetic authentication; TLS/public DNS checks retained, no inference request.",
    );
  } else {
    console.error(
      JSON.stringify({
        native_reachability: "blocked",
        code: error instanceof ConnectionError ? error.code : "response",
      }),
    );
    process.exitCode = 1;
  }
}
