import test from "node:test";
import assert from "node:assert/strict";
import {
  readConversations,
  replaceConversation,
  resetConversation,
  writeConversations,
  STORAGE_KEY,
} from "../src/conversations.ts";
import type { Message } from "../shared/characters.ts";
const user: Message = { id: "1", role: "user", content: "hello" };
const answer: Message = { id: "2", role: "assistant", content: "hi" };
test("saving and reloading isolates characters; reset removes only the chosen conversation", () => {
  let raw = "";
  const storage = {
    getItem: (key: string) => {
      assert.equal(key, STORAGE_KEY);
      return raw;
    },
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  let data = replaceConversation({}, "lin", [user, answer]);
  data = replaceConversation(data, "dou", [{ ...user, content: "woof" }]);
  assert.equal(writeConversations(storage, data), true);
  const saved = readConversations(storage);
  assert.deepEqual(saved.lin, [user, answer]);
  const reset = resetConversation(saved, "lin");
  assert.equal(reset.lin, undefined);
  assert.equal(reset.dou?.[0].content, "woof");
  assert.equal(saved.lin?.length, 2);
});
test("storage failures and corrupted data do not crash the app", () => {
  assert.deepEqual(readConversations({ getItem: () => "{bad" }), {});
  assert.deepEqual(
    readConversations({
      getItem: () =>
        JSON.stringify({ unknown: [user], lin: [{ ...user, role: "system" }] }),
    }),
    {},
  );
  assert.equal(
    writeConversations(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      {},
    ),
    false,
  );
});
test("bounded histories preserve alternating turns and restore an unanswered last user message", () => {
  const messages = Array.from({ length: 205 }, (_, index): Message => ({
    id: String(index),
    role: index % 2 ? "assistant" : "user",
    content: "test",
  }));
  const data = replaceConversation({}, "lin", messages);
  assert.equal(data.lin?.length, 199);
  assert.equal(data.lin?.[0].role, "user");
  assert.equal(data.lin?.at(-1)?.role, "user");
  assert.deepEqual(
    readConversations({ getItem: () => JSON.stringify(data) }),
    data,
  );
});
