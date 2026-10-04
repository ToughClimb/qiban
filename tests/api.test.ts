import test from "node:test";
import assert from "node:assert/strict";
import { ChatError, sendMessage } from "../src/api.ts";

test("chat responses carry their actual mode; missing or unknown modes are rejected", async () => {
  const original = globalThis.fetch;
  try {
    for (const mode of ["demo", "live"]) {
      globalThis.fetch = async () => Response.json({ content: "reply", mode });
      assert.deepEqual(
        await sendMessage(
          "lin",
          [{ id: "1", role: "user", content: "hello" }],
          "",
          new AbortController().signal,
        ),
        { content: "reply", mode },
      );
    }
    for (const mode of [undefined, "unknown"]) {
      globalThis.fetch = async () => Response.json({ content: "reply", mode });
      await assert.rejects(
        sendMessage(
          "lin",
          [{ id: "1", role: "user", content: "hello" }],
          "",
          new AbortController().signal,
        ),
        ChatError,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
