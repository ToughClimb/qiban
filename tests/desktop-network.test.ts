import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type RequestOptions } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createJsonTransport, ConnectionError } from "../desktop/network.js";
test("real HTTPS transport pins DNS and never follows any redirect or leaks its key there", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-tls-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=provider.invalid",
      "-addext",
      "subjectAltName=DNS:provider.invalid",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(directory, "cert.pem"));
  let redirected = 0,
    original = 0;
  const server = createServer(
    { key: readFileSync(join(directory, "key.pem")), cert },
    (req, res) => {
      if (req.url === "/redirected") {
        redirected++;
        res.end("{}");
        return;
      }
      original++;
      assert.equal(
        req.headers.authorization,
        "Bearer synthetic-redirect-fixture",
      );
      res.writeHead(Number(req.url!.slice(1)), { location: "/redirected" });
      res.end("private provider detail");
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const transport = createJsonTransport(
    async () => [{ address: "8.8.8.8", family: 4 }],
    ((
      url: URL,
      options: RequestOptions,
      callback: Parameters<typeof request>[2],
    ) => {
      options.lookup!("provider.invalid", {}, ((
        error: unknown,
        address: string,
        family: number,
      ) => {
        assert.equal(error, null);
        assert.equal(address, "8.8.8.8");
        assert.equal(family, 4);
      }) as never);
      return request(
        url,
        {
          ...options,
          ca: cert,
          lookup: (_host, _options, done) => done(null, "127.0.0.1", 4),
        },
        callback,
      );
    }) as typeof request,
  );
  for (const code of [301, 302, 303, 307, 308])
    await assert.rejects(
      transport(
        new URL(`https://provider.invalid:${port}/${code}`),
        "synthetic-redirect-fixture",
      ),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.code === "redirect" &&
        !error.message.includes("private provider detail"),
    );
  assert.equal(original, 5);
  assert.equal(redirected, 0);
});
