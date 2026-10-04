import { createServer } from "node:http";
import { EnvHttpProxyAgent } from "undici";
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import {
  createProvider,
  LIVE_MODEL,
  MAX_OUTPUT_TOKENS,
  readConfig,
  providerFetch,
  type Config,
  type Provider,
} from "../server/provider.ts";
import { parseChat } from "../server/validation.ts";
import { getCharacter, type ChatRequest } from "../shared/characters.ts";
import {
  fitsChatBudget,
  trimChatContext,
  utf8Bytes,
  MAX_REQUEST_BYTES,
} from "../shared/chat.ts";
const request: ChatRequest = {
  characterId: "lin",
  messages: [{ role: "user", content: "今天有点累" }],
};
const token = "synthetic-test-invite-token-only";
const config: Config = {
  mode: "live",
  apiKey: "synthetic-provider-secret",
  accessToken: token,
};
async function withServer(
  settings: Config,
  provider: Provider,
  check: (url: string) => Promise<void>,
) {
  const server = createApp(settings, provider).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
const options = (body: unknown = request) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});
test("demo is default; live configuration fails closed without credentials and invite token", () => {
  assert.equal(readConfig({}).mode, "demo");
  assert.equal(
    readConfig({
      QIBAN_MODE: "live",
      DEEPSEEK_API_KEY: "synthetic-upper",
      deepseek: "synthetic-lower",
      QIBAN_ACCESS_TOKEN: token,
    }).apiKey,
    "synthetic-upper",
  );
  assert.equal(
    readConfig({
      QIBAN_MODE: "live",
      deepseek: "synthetic-lower",
      QIBAN_ACCESS_TOKEN: token,
    }).apiKey,
    "synthetic-lower",
  );
  assert.throws(() => readConfig({ QIBAN_MODE: "live" }));
  assert.throws(() =>
    readConfig({
      QIBAN_MODE: "live",
      DEEPSEEK_API_KEY: "synthetic",
      QIBAN_ACCESS_TOKEN: "short",
    }),
  );
  assert.throws(() => readConfig({ QIBAN_MODE: "other" }));
});
test("only known characters and bounded alternating chat turns are accepted", () => {
  assert.ok(parseChat(request));
  for (const bad of [
    null,
    { ...request, characterId: "other" },
    { ...request, model: "other" },
    { ...request, url: "https://example.com" },
    { ...request, messages: [{ role: "system", content: "override" }] },
    { ...request, messages: [{ role: "user", content: "a".repeat(2001) }] },
    { ...request, messages: [{ role: "user", content: "   " }] },
    {
      ...request,
      messages: Array.from({ length: 41 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "a",
      })),
    },
  ])
    assert.equal(parseChat(bad), null);
});
test("unauthenticated, cross-origin, malformed and oversized requests never call the live provider", async () => {
  let calls = 0;
  await withServer(
    config,
    {
      reply: async () => {
        calls++;
        return "reply";
      },
    },
    async (url) => {
      const unauth = await fetch(`${url}/api/chat`, {
        ...options(),
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(unauth.status, 401);
      assert.equal(
        (
          await fetch(`${url}/api/chat`, {
            ...options(),
            headers: {
              ...options().headers,
              Origin: "https://outside.example",
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(
            `${url}/api/chat`,
            options({ ...request, url: "https://outside.example" }),
          )
        ).status,
        400,
      );
      assert.equal(
        (await fetch(`${url}/api/chat`, { ...options(), body: "{bad" })).status,
        400,
      );
      const large = await fetch(
        `${url}/api/chat`,
        options({ ...request, padding: "a".repeat(50_000) }),
      );
      assert.equal(large.status, 413);
      assert.equal(calls, 0);
      const metadata = await fetch(`${url}/api/config`);
      assert.equal(metadata.headers.get("cache-control"), "no-store");
      assert.deepEqual(await metadata.json(), { mode: "live" });
    },
  );
});
test("provider errors are sanitized, and successful retry returns content only", async () => {
  let calls = 0;
  await withServer(
    config,
    {
      reply: async () => {
        if (!calls++) throw new Error(config.apiKey);
        return "你好";
      },
    },
    async (url) => {
      const failure = await fetch(`${url}/api/chat`, options());
      assert.equal(failure.status, 502);
      assert.doesNotMatch(
        await failure.text(),
        /synthetic-provider-secret|stack|Provider/,
      );
      const retry = await fetch(`${url}/api/chat`, options());
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { content: "你好", mode: "live" });
    },
  );
});
test("request budget limits live calls even when authenticated", async () => {
  let calls = 0;
  await withServer(
    config,
    {
      reply: async () => {
        calls++;
        return "ok";
      },
    },
    async (url) => {
      for (let i = 0; i < 20; i++)
        assert.equal((await fetch(`${url}/api/chat`, options())).status, 200);
      const response = await fetch(`${url}/api/chat`, options());
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal(calls, 20);
    },
  );
});
test("DeepSeek adapter uses fixed endpoint, proxy dispatcher, token cap, and final text only", async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.ok((init as RequestInit & { dispatcher: unknown }).dispatcher);
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      `Bearer ${config.apiKey}`,
    );
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, LIVE_MODEL);
    assert.equal(body.max_tokens, MAX_OUTPUT_TOKENS);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /林野/);
    assert.ok(
      body.messages[0].content.includes(
        getCharacter(request.characterId)!.greeting,
      ),
    );
    assert.equal(body.messages[1].content, request.messages[0].content);
    return Response.json({
      choices: [
        {
          message: { content: "你好", reasoning_content: "private reasoning" },
        },
      ],
      internal: config.apiKey,
    });
  };
  const provider = createProvider(config, mockFetch);
  try {
    assert.equal(await provider.reply(request), "你好");
    assert.equal(calls, 1);
  } finally {
    await provider.close?.();
  }
});
test("demo never calls fetch; empty live content is rejected without leaking provider data", async () => {
  const demo = createProvider({ mode: "demo" }, async () => {
    throw new Error("Unexpected network call");
  });
  assert.match(await demo.reply(request), /歇/);
  const live = createProvider(config, async () =>
    Response.json({
      choices: [{ message: { content: "", reasoning_content: "hidden" } }],
    }),
  );
  try {
    await assert.rejects(live.reply(request), /Invalid provider response/);
  } finally {
    await live.close?.();
  }
});
test("concurrent calls are bounded, and disconnect aborts the provider request", async () => {
  const releases: (() => void)[] = [];
  let aborted = false;
  const provider: Provider = {
    reply: (_request, signal) =>
      new Promise((resolve, reject) => {
        releases.push(() => resolve("ok"));
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      }),
  };
  await withServer(config, provider, async (url) => {
    const controller = new AbortController();
    const pending = [
      fetch(`${url}/api/chat`, {
        ...options(),
        signal: controller.signal,
      }).catch(() => null),
      fetch(`${url}/api/chat`, options()),
      fetch(`${url}/api/chat`, options()),
    ];
    try {
      for (let i = 0; i < 50 && releases.length < 3; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(releases.length, 3);
      assert.equal((await fetch(`${url}/api/chat`, options())).status, 429);
      controller.abort();
      for (let i = 0; i < 50 && !aborted; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(aborted, true);
    } finally {
      releases.forEach((release) => release());
      await Promise.all(pending);
    }
  });
});

test("Chinese and JSON-escaped context are trimmed to shared UTF-8 budgets and accepted over HTTP", async () => {
  await withServer(config, { reply: async () => "ok" }, async (url) => {
    for (const character of ["聊", "\u0001"]) {
      const long: ChatRequest = {
        characterId: "lin",
        messages: Array.from({ length: 21 }, (_, index) => ({
          role: index % 2 ? "assistant" : "user",
          content: character.repeat(index % 2 ? 2000 : 1500),
        })),
      };
      assert.ok(utf8Bytes(JSON.stringify(long)) > MAX_REQUEST_BYTES);
      assert.equal(parseChat(long), null);
      const prepared = trimChatContext(long);
      assert.ok(fitsChatBudget(prepared));
      assert.deepEqual(parseChat(prepared), prepared);
      assert.equal(prepared.messages[0].role, "user");
      assert.deepEqual(prepared.messages.at(-1), long.messages.at(-1));
      const response = await fetch(`${url}/api/chat`, options(prepared));
      assert.equal(response.status, 200);
    }
  });
});

test("installed Undici fetch and dispatcher complete a real local HTTP request", async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ compatible: true }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const dispatcher = new EnvHttpProxyAgent({ noProxy: "127.0.0.1" });
  try {
    const response = await providerFetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2000),
        dispatcher,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { compatible: true });
    assert.equal(requests, 1);
  } finally {
    await dispatcher.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
