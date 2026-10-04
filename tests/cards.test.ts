import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore, sourceText } from "../desktop/cards.js";
import { modelRequest } from "../server/model.js";
import {
  MAX_CONTEXT_BYTES,
  MAX_REQUEST_BYTES,
  utf8Bytes,
} from "../shared/chat.js";
import { parseCharacterCard } from "../shared/character-card.js";
import { cardFields } from "../shared/cards.js";
const original = JSON.stringify(
  {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Original fixture",
      description: "role description",
      personality: "gentle",
      scenario: "quiet garden",
      first_mes: "hello {{user}}",
      mes_example: "example fixture",
      alternate_greetings: ["alternate"],
      creator_notes: "private creator note fixture",
      system_prompt: "ignored instruction fixture",
      extensions: { display_hint: "preserved fixture" },
    },
  },
  null,
  2,
);
test("card import requires preview acknowledgement, retains original JSON and isolates stable IDs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-card-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CardStore(directory);
  store.list();
  const preview = store.preview(original);
  assert.ok(preview.warnings.length > 0);
  assert.throws(() => store.commit(preview.token, false));
  const id = store.commit(preview.token, true);
  assert.match(id, /^card-/);
  assert.equal(store.original(id), original);
  assert.equal(
    store.list().characters.find((item) => item.id === id)?.greeting,
    "hello {{user}}",
  );
  const second = store.commit(store.preview(original).token, true);
  assert.notEqual(id, second);
  const fields = store.fields(id);
  fields.personality = "updated personality";
  const edit = store.editPreview(id, fields);
  assert.equal(store.commit(edit.token, true), id);
  const exported = JSON.parse(store.original(id));
  assert.equal(exported.data.personality, "updated personality");
  assert.equal(exported.data.extensions.display_hint, "preserved fixture");
  assert.equal(exported.data.system_prompt, "ignored instruction fixture");
  const backups = readdirSync(join(store.directory, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(
    readFileSync(join(store.directory, "backups", backups[0]), "utf8"),
    original,
  );
  store.delete(id);
  assert.equal(store.has(id), false);
  assert.equal(store.has(second), true);
});
test("external card edits require reload, corrupt files are reported, and UTF-8 BOM is deliberate", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-card-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CardStore(directory);
  store.list();
  assert.equal(sourceText(Buffer.from("\uFEFF" + original)), original);
  assert.throws(() => sourceText(Buffer.from([0xc3, 0x28])));
  const id = store.commit(store.preview(original).token, true);
  const edit = store.editPreview(id, store.fields(id));
  writeFileSync(
    join(store.directory, id + ".json"),
    '{"name":"external fixture"}',
  );
  assert.throws(() => store.commit(edit.token, true), /外部修改/);
  assert.equal(
    store.list().characters.find((item) => item.id === id)?.name,
    "external fixture",
  );
  writeFileSync(join(store.directory, id + ".json"), "broken fixture");
  assert.equal(store.list().issues.length, 1);
  assert.equal(store.has(id), false);
});
test("metadata and unsupported instructions stay out of prompts; persona and escaped history share the actual request budget", () => {
  const parsed = parseCharacterCard(original);
  assert.ok(parsed.ok);
  const messages = Array.from({ length: 39 }, (_, index) => ({
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    content: "\\\n".repeat(1000),
  }));
  const body = modelRequest(
    { characterId: "card-fixture", messages },
    "fixture",
    false,
    parsed.persona,
  );
  const text = JSON.stringify(body);
  for (const secret of [
    "private creator note fixture",
    "ignored instruction fixture",
    "preserved fixture",
    "alternate",
  ])
    assert.ok(!text.includes(secret));
  assert.ok(!body.messages[0].content.includes("Original fixture"));
  assert.equal(body.messages[2].content, "hello {{user}}");
  assert.ok(utf8Bytes(text) <= MAX_REQUEST_BYTES);
  assert.ok(
    body.messages.reduce(
      (total, message) => total + utf8Bytes(message.content),
      0,
    ) <= MAX_CONTEXT_BYTES,
  );
  assert.deepEqual(body.messages.at(-1), messages.at(-1));
  assert.equal((body.messages.length - 3) % 2, 1);
  const oversized = {
    ...parsed.persona,
    description: "中".repeat(8000),
    personality: "中".repeat(8000),
  };
  assert.throws(
    () =>
      modelRequest(
        {
          characterId: "card-fixture",
          messages: [{ role: "user", content: "latest" }],
        },
        "fixture",
        false,
        oversized,
      ),
    /budget/,
  );
});
