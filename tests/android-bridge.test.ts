import assert from "node:assert/strict";
import { test } from "node:test";
import { createAndroidBridge, type AndroidPlugin } from "../src/android/bridge";
import type { ConnectionStatus, Result } from "../shared/desktop";
import type { CardFields } from "../shared/cards";

const id = "card-11111111-1111-1111-1111-111111111111";
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const original = JSON.stringify({
  name: "小禾",
  description: "原创园丁",
  personality: "温和",
  scenario: "庭院",
  first_mes: "你好",
  mes_example: "",
  creator_notes: "仅供编辑者阅读",
  tags: ["原创"],
});
const edits: CardFields = {
  name: "小禾",
  description: "原创园丁",
  personality: "耐心",
  scenario: "庭院",
  firstMessage: "你好",
  exampleDialogue: "",
};
function fixture() {
  let raw = original;
  let saved = "";
  let calls = 0;
  let persona: CardFields | undefined;
  const state: ConnectionStatus = {
    mode: "demo",
    baseUrl: "https://example.invalid/v1",
    model: "",
    models: [],
    hasKey: false,
    remembered: false,
    needsSelection: false,
  };
  const native = {
    listCards: async () => ok({ cards: [{ id, raw }], issues: [] }),
    importCard: async () => ok({ raw }),
    saveCard: async (input: { raw: string }) => {
      saved = input.raw;
      raw = saved;
      return ok(id);
    },
    status: async () => ok(state),
    connect: async () => {
      calls++;
      return ok(state);
    },
    chat: async (input: { persona: CardFields }) => {
      persona = input.persona;
      return ok({ content: "你好", mode: "demo" as const });
    },
  } as unknown as AndroidPlugin;
  return {
    bridge: createAndroidBridge(native),
    change: (value: string) => {
      raw = value;
    },
    saved: () => saved,
    calls: () => calls,
    persona: () => persona,
  };
}

test("Android import requires explicit acknowledgement and preserves source metadata", async () => {
  const f = fixture();
  const preview = await f.bridge.importCard();
  assert.ok(preview.ok && preview.value);
  assert.equal((await f.bridge.saveCard(preview.value.token, false)).ok, false);
  assert.equal(f.saved(), "");
  assert.equal((await f.bridge.saveCard(preview.value.token, true)).ok, true);
  assert.equal(f.saved(), original);
});

test("Android edits preserve opaque fields and reject a stale preview", async () => {
  const f = fixture();
  let preview = await f.bridge.previewCard(id, edits);
  assert.ok(preview.ok);
  f.change(original.replace("温和", "别的编辑"));
  assert.equal((await f.bridge.saveCard(preview.value.token, true)).ok, false);
  assert.equal(f.saved(), "");
  preview = await f.bridge.previewCard(id, edits);
  assert.ok(preview.ok);
  assert.equal((await f.bridge.saveCard(preview.value.token, true)).ok, true);
  assert.deepEqual(JSON.parse(f.saved()).tags, ["原创"]);
  assert.equal(JSON.parse(f.saved()).creator_notes, "仅供编辑者阅读");
  assert.equal(JSON.parse(f.saved()).personality, "耐心");
});

test("Android chat carries only the six persona fields, never card metadata", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.bridge.chat(
        { characterId: id, messages: [{ role: "user", content: "你好" }] },
        "request-one",
      )
    ).ok,
    true,
  );
  assert.deepEqual(Object.keys(f.persona()!).sort(), Object.keys(edits).sort());
  assert.equal(JSON.stringify(f.persona()).includes("仅供编辑者阅读"), false);
});

test("Android bridge refuses renderer credentials and excludes invalid cards", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.bridge.connect({
        baseUrl: "https://example.invalid",
        apiKey: "synthetic-test-key",
        remember: false,
      })
    ).ok,
    false,
  );
  assert.equal(f.calls(), 0);
  f.change('{"name":"坏格式","tools":[{"type":"function"}]}');
  const cards = await f.bridge.cards();
  assert.ok(cards.ok);
  assert.equal(
    cards.value.characters.some((card) => card.id === id),
    false,
  );
  assert.equal(cards.value.issues.length, 1);
});
