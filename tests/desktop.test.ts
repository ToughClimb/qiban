import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionStore, type Encryption } from "../desktop/store.js";
import { DesktopService } from "../desktop/service.js";
import {
  ConnectionError,
  normalizeEndpoint,
  publicAddresses,
} from "../desktop/network.js";
import { HistoryStore } from "../desktop/history.js";
const syntheticKey = "synthetic-test-key-only";
const crypto: Encryption = {
  isEncryptionAvailable: () => true,
  encryptString: () => Buffer.from("ciphertext-fixture"),
  decryptString: () => syntheticKey,
};
function fixture(t: { after(fn: () => void): void }, encryption = crypto) {
  const directory = mkdtempSync(join(tmpdir(), "qiban-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new ConnectionStore(directory, encryption) };
}
test("remembering is opt-in, encrypted, and fails closed without safe storage", (t) => {
  const { directory, store } = fixture(t);
  const connection = {
    baseUrl: "https://provider.example",
    model: "one",
    models: ["one"],
    enabled: true,
    remembered: false,
  };
  store.save(connection, syntheticKey, false);
  assert.equal(store.load().key, undefined);
  assert.ok(
    !readFileSync(join(directory, "connection.json"), "utf8").includes(
      syntheticKey,
    ),
  );
  store.save(connection, syntheticKey, true);
  assert.equal(store.load().key, syntheticKey);
  assert.ok(
    !readFileSync(join(directory, "connection.json"), "utf8").includes(
      syntheticKey,
    ),
  );
  const unavailable = new ConnectionStore(directory, {
    ...crypto,
    isEncryptionAvailable: () => false,
  });
  assert.throws(
    () => unavailable.save(connection, syntheticKey, true),
    ConnectionError,
  );
  assert.equal(unavailable.load().key, undefined);
  assert.equal(unavailable.load().enabled, false);
  const broken = new ConnectionStore(directory, {
    ...crypto,
    encryptString: () => {
      throw Error("synthetic failure");
    },
  });
  assert.throws(
    () => broken.save(connection, syntheticKey, true),
    ConnectionError,
  );
});
test("a changed provider cannot reuse a key, and failed discovery leaves settings intact", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const service = new DesktopService(store, async (_url, key) => {
    calls++;
    assert.equal(key, syntheticKey);
    return { data: [{ id: "one" }] };
  });
  const status = await service.connect({
    baseUrl: "https://provider.example/v1/chat/completions",
    apiKey: syntheticKey,
    remember: false,
  });
  assert.equal(status.mode, "live");
  assert.equal(status.baseUrl, "https://provider.example/v1");
  assert.ok(!JSON.stringify(status).includes(syntheticKey));
  await assert.rejects(
    service.connect({
      baseUrl: "https://another.example/v1",
      apiKey: "",
      remember: false,
    }),
    /更换地址/,
  );
  assert.equal(calls, 1);
  assert.equal(service.status().baseUrl, status.baseUrl);
});
test("deleting a key cancels discovery and a late result cannot restore it", async (t) => {
  const { store } = fixture(t);
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const service = new DesktopService(
    store,
    async (_url, _key, _body, abort) => {
      signal = abort;
      return new Promise((resolve) => (finish = resolve));
    },
  );
  const pending = service.connect({
    baseUrl: "https://provider.example",
    apiKey: syntheticKey,
    remember: true,
  });
  service.deleteKey();
  assert.equal(signal?.aborted, true);
  finish({ data: [{ id: "one" }] });
  await assert.rejects(pending, /取消/);
  assert.equal(service.status().hasKey, false);
  assert.equal(store.load().key, undefined);
});
test("unknown multiple models need selection; deleting data cancels chat", async (t) => {
  const { store } = fixture(t);
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const service = new DesktopService(store, async (_url, _key, body, abort) => {
    if (!body) return { data: [{ id: "one" }, { id: "two" }] };
    signal = abort;
    return new Promise((resolve) => (finish = resolve));
  });
  assert.equal(
    (
      await service.connect({
        baseUrl: "https://provider.example",
        apiKey: syntheticKey,
        remember: false,
      })
    ).needsSelection,
    true,
  );
  assert.throws(() => service.selectModel("not-offered"), ConnectionError);
  service.selectModel("one");
  const pending = service.chat(
    { characterId: "lin", messages: [{ role: "user", content: "hello" }] },
    "fixture",
  );
  service.deleteData();
  assert.equal(signal?.aborted, true);
  finish({ choices: [{ message: { content: "late" } }] });
  await assert.rejects(pending, /取消/);
  assert.equal(service.status().mode, "demo");
  assert.equal(service.status().hasKey, false);
});
test("endpoint validation rejects private targets, embedded credentials, and mixed DNS", async () => {
  for (const url of [
    "http://provider.example",
    "https://127.0.0.1",
    "https://[::1]",
    "https://169.254.169.254",
    "https://user:secret@provider.example",
    "https://provider.example/?key=value",
    "https://provider.example/%2fpath",
  ])
    assert.throws(() => normalizeEndpoint(url), ConnectionError);
  await assert.rejects(
    publicAddresses(
      "provider.example",
      async () =>
        [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ] as never,
    ),
    ConnectionError,
  );
});
test("local histories stay isolated and corrupted data is never silently overwritten", (t) => {
  const { directory } = fixture(t);
  const history = new HistoryStore(directory);
  const one = {
    lin: [
      { id: "u", role: "user" as const, content: "lin only" },
      {
        id: "a",
        role: "assistant" as const,
        content: "reply",
        mode: "demo" as const,
      },
    ],
    dou: [],
  };
  history.save(one);
  assert.deepEqual(history.load(), one);
  history.save({ ...one, lin: [] });
  assert.deepEqual(history.load(), { lin: [], dou: [] });
  writeFileSync(join(directory, "history.json"), "broken fixture");
  assert.throws(() => history.load(), ConnectionError);
  assert.equal(
    readFileSync(join(directory, "history.json"), "utf8"),
    "broken fixture",
  );
  history.clear();
  assert.deepEqual(history.load(), {});
});
