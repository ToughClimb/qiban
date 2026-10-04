import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer, request, type RequestOptions } from "node:https";
import { connect } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonTransport, ConnectionError, publicAddresses } from "../desktop/network.js";
import { configuredProxy } from "../desktop/proxy.js";

test("proxy environment precedence, HTTP fallback, and invalid configuration fail closed", async () => {
  assert.equal(configuredProxy({ https_proxy: "http://lower.invalid", HTTPS_PROXY: "https://upper.invalid" })?.hostname, "lower.invalid");
  assert.equal(configuredProxy({ HTTPS_PROXY: "https://secure.invalid", HTTP_PROXY: "http://fallback.invalid" })?.protocol, "https:");
  assert.equal(configuredProxy({ http_proxy: "http://fallback.invalid" })?.hostname, "fallback.invalid");
  assert.equal(configuredProxy({}), undefined);
  for (const value of ["bad", "socks://proxy.invalid", "http://proxy.invalid/path", "http://proxy.invalid?secret=synthetic", "http://proxy.invalid/#fragment", "http://%zz:synthetic@proxy.invalid"]) {
    let resolutions = 0;
    const transport = createJsonTransport(async () => { resolutions++; return []; }, request, { HTTPS_PROXY: value });
    await assert.rejects(transport(new URL("https://provider.invalid/models"), "synthetic-unused-key"), (error: unknown) =>
      error instanceof ConnectionError && error.code === "proxy" && !error.message.includes(value));
    assert.equal(resolutions, 0);
  }
});

test("real HTTP(S) proxy tunnels retain pinned destination, CA/hostname checks and redirect denial", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "qiban-proxy-tls-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
    "-days", "1", "-subj", "/CN=provider.invalid", "-addext",
    "subjectAltName=DNS:provider.invalid,DNS:proxy.invalid,DNS:localhost"], { stdio: "ignore" });
  const cert = readFileSync(join(directory, "cert.pem"));
  const tls = { key: readFileSync(join(directory, "key.pem")), cert };
  let providerRequests = 0;
  let leakedRedirectRequests = 0;
  const provider = createHttpsServer(tls, (req, res) => {
    providerRequests++;
    assert.equal(req.headers.authorization, "Bearer synthetic-provider-key");
    assert.equal(req.headers["proxy-authorization"], undefined);
    if (req.url === "/redirected") leakedRedirectRequests++;
    if (/^\/30[12378]$/.test(req.url!)) {
      res.writeHead(Number(req.url!.slice(1)), { location: "/redirected" });
      res.end("private synthetic provider detail");
    } else if (req.url === "/large") res.end(JSON.stringify({ text: "x".repeat(128 * 1024) }));
    else if (req.url === "/slow") { /* Wait for client cancellation. */ }
    else res.end(JSON.stringify({ ok: true, servername: (req.socket as { servername?: string }).servername }));
  });
  provider.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  const port = (provider.address() as { port: number }).port;
  const proxyAddresses: string[] = [];
  const sockets = new Set<import("node:stream").Duplex>();
  for (const protocol of ["http", "https"]) {
    const proxy = protocol === "https" ? createHttpsServer(tls) : createHttpServer();
    proxy.on("tlsClientError", () => {});
    proxy.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    proxy.on("connect", (req, downstream, head) => {
      assert.equal(head.length, 0);
      proxyAddresses.push(req.url!);
      assert.equal(req.url, `8.8.8.8:${port}`);
      assert.ok([`provider.invalid:${port}`, `wrong.invalid:${port}`].includes(req.headers.host!));
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers["proxy-authorization"], `Basic ${Buffer.from("synthetic-user:synthetic-proxy-password").toString("base64")}`);
      // Only this disposable test proxy maps the asserted public IP to a local
      // TLS fixture. Production has no local mapping or destination override.
      const upstream = connect(port, "127.0.0.1", () => {
        downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        downstream.pipe(upstream).pipe(downstream);
      });
      sockets.add(upstream);
      upstream.once("close", () => { sockets.delete(upstream); downstream.destroy(); });
      downstream.once("close", () => upstream.destroy());
      upstream.on("error", () => downstream.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    t.after(() => { for (const socket of sockets) socket.destroy(); proxy.close(); });
    const proxyPort = (proxy.address() as { port: number }).port;
    const env = { HTTPS_PROXY: `${protocol}://synthetic-user:synthetic-proxy-password@${protocol === "https" ? "localhost" : "127.0.0.1"}:${proxyPort}`, NO_PROXY: "*" };
    const wrapped = ((url: URL, options: RequestOptions, callback: Parameters<typeof request>[2]) => {
      assert.ok(options.agent); // NO_PROXY cannot bypass a configured provider proxy.
      return request(url, { ...options, ca: cert }, callback);
    }) as typeof request;
    const transport = createJsonTransport(async () => [{ address: "8.8.8.8", family: 4 }], wrapped, env);
    assert.deepEqual(await transport(new URL(`https://provider.invalid:${port}/ok`), "synthetic-provider-key"), { ok: true, servername: "provider.invalid" });
    for (const status of [301, 302, 303, 307, 308]) {
      await assert.rejects(transport(new URL(`https://provider.invalid:${port}/${status}`), "synthetic-provider-key"), (error: unknown) =>
        error instanceof ConnectionError && error.code === "redirect" && !error.message.includes("private"));
    }
    await assert.rejects(transport(new URL(`https://provider.invalid:${port}/large`), "synthetic-provider-key"), (error: unknown) => error instanceof ConnectionError && error.code === "unsupported");
    const abort = new AbortController();
    const pending = transport(new URL(`https://provider.invalid:${port}/slow`), "synthetic-provider-key", {}, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending, (error: unknown) => error instanceof ConnectionError && error.code === "cancelled");
    const before = providerRequests;
    // Untrusted CA and wrong provider hostname both fail before Authorization is sent.
    const untrusted = createJsonTransport(async () => [{ address: "8.8.8.8", family: 4 }], request, env);
    await assert.rejects(untrusted(new URL(`https://provider.invalid:${port}/ok`), "synthetic-provider-key"), ConnectionError);
    if (protocol === "http") {
      await assert.rejects(transport(new URL(`https://wrong.invalid:${port}/ok`), "synthetic-provider-key"), ConnectionError);
    }
    assert.equal(providerRequests, before);
  }
  assert.ok(proxyAddresses.length >= 16);
  assert.equal(leakedRedirectRequests, 0);
});

test("private, mixed or unresolved destination DNS stops before contacting the proxy", async (t) => {
  let connections = 0;
  const proxy = createHttpServer();
  proxy.on("connection", (socket) => { connections++; socket.destroy(); });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => proxy.close());
  const env = { HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` };
  for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
    const resolver = (host: string) => publicAddresses(host, (async () => addresses) as never);
    await assert.rejects(createJsonTransport(resolver, request, env)(new URL("https://provider.invalid/models"), "synthetic-unused-key"), (error: unknown) => error instanceof ConnectionError && error.code === "url");
  }
  const unavailable = createJsonTransport(async () => { throw new Error("synthetic DNS unavailable"); }, request, env);
  await assert.rejects(unavailable(new URL("https://provider.invalid/models"), "synthetic-unused-key"), (error: unknown) => error instanceof ConnectionError && error.code === "network");
  await assert.rejects(unavailable(new URL("https://127.0.0.1/models"), "synthetic-unused-key"), (error: unknown) => error instanceof ConnectionError && error.code === "url");
  assert.equal(connections, 0);
});

test("CONNECT redirects/auth failures are sanitized and never fall back to direct egress", async (t) => {
  let connects = 0;
  let directRequests = 0;
  let code = 302;
  const proxy = createHttpServer();
  proxy.on("connect", (_req, socket) => {
    connects++;
    socket.end(`HTTP/1.1 ${code} Refused\r\nLocation: https://private.invalid\r\n\r\n`);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => proxy.close());
  const wrapped = ((url: URL, options: RequestOptions, callback: Parameters<typeof request>[2]) => {
    if (!options.agent) directRequests++;
    return request(url, options, callback);
  }) as typeof request;
  const transport = createJsonTransport(async () => [{ address: "8.8.8.8", family: 4 }], wrapped,
    { HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as { port: number }).port}` });
  for (code of [302, 407, 502]) {
    await assert.rejects(transport(new URL("https://provider.invalid/models"), "synthetic-unused-key"),
      (error: unknown) => error instanceof ConnectionError && error.code === "proxy" && error.httpStatus === code && !error.message.includes("private"));
  }
  assert.equal(connects, 3);
  assert.equal(directRequests, 0);
});
