import { Agent, request as httpsRequest, type RequestOptions } from "node:https";
import { request as httpRequest, type ClientRequest } from "node:http";
import { connect as connectTls } from "node:tls";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import type { LookupAddress } from "node:dns";

// Environment configuration is main-process-only. A configured proxy is always
// used for provider traffic: NO_PROXY cannot send a network-secret placeholder
// directly to a provider. There is no direct fallback on proxy failure.
export function configuredProxy(env: NodeJS.ProcessEnv): URL | undefined {
  const value = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY;
  if (!value) return;
  const proxy = new URL(value);
  if (
    !["http:", "https:"].includes(proxy.protocol) ||
    proxy.search || proxy.hash || proxy.pathname !== "/"
  ) throw new Error("Invalid provider proxy configuration");
  // Reject malformed userinfo before opening a connection.
  decodeURIComponent(proxy.username);
  decodeURIComponent(proxy.password);
  return proxy;
}

export class ProxyConnectError extends Error {
  constructor(readonly status?: number) {
    super("Provider proxy refused CONNECT");
  }
}

// CONNECT uses the already validated public IP, never a second DNS resolution
// of the user-selected provider. Host and TLS identity retain the original name.
export class PinnedProxyAgent extends Agent {
  private proxyRequest?: ClientRequest;
  private tunnel?: Duplex;
  private readonly abort = () => this.destroy();

  constructor(
    private readonly proxy: URL,
    private readonly target: URL,
    private readonly pinned: LookupAddress,
    private readonly signal: AbortSignal,
  ) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    signal.addEventListener("abort", this.abort, { once: true });
  }

  override createConnection(
    options: RequestOptions,
    callback?: (error: Error | null, socket: Duplex) => void,
  ): undefined {
    let finished = false;
    const finish = (error: Error | null, socket?: Duplex) => {
      if (finished) return;
      finished = true;
      callback?.(error, socket!);
    };
    if (this.signal.aborted) {
      finish(new Error("Provider request cancelled"));
      return;
    }
    const address = this.pinned.family === 6
      ? `[${this.pinned.address}]` : this.pinned.address;
    const port = this.target.port || "443";
    const headers: Record<string, string> = { Host: `${this.target.hostname}:${port}` };
    if (this.proxy.username || this.proxy.password) {
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(
        `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`,
      ).toString("base64")}`;
    }
    const requester = this.proxy.protocol === "https:" ? httpsRequest : httpRequest;
    // URL userinfo would make Node add an origin Authorization header. Proxy
    // credentials belong exclusively in Proxy-Authorization on CONNECT.
    const proxyEndpoint = new URL(this.proxy);
    proxyEndpoint.username = "";
    proxyEndpoint.password = "";
    this.proxyRequest = requester(proxyEndpoint, {
      method: "CONNECT",
      path: `${address}:${port}`,
      headers,
      agent: false,
      signal: this.signal,
      rejectUnauthorized: true,
      ca: options.ca,
    });
    this.proxyRequest.once("error", (error) => finish(error));
    this.proxyRequest.once("response", (response) => {
      response.destroy();
      finish(new ProxyConnectError(response.statusCode));
    });
    this.proxyRequest.once("connect", (response, socket, head) => {
      this.tunnel = socket;
      if (response.statusCode !== 200 || head.length || this.signal.aborted) {
        socket.destroy();
        finish(new ProxyConnectError(response.statusCode));
        return;
      }
      const host = this.target.hostname.replace(/^\[|\]$/g, "");
      const secure = connectTls({
        socket,
        host,
        ca: options.ca,
        servername: isIP(host) ? undefined : host,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
      });
      this.tunnel = secure;
      secure.once("error", (error) => finish(error));
      secure.once("secureConnect", () => finish(null, secure));
    });
    this.proxyRequest.end();
    return;
  }

  override destroy(): void {
    this.signal.removeEventListener("abort", this.abort);
    this.proxyRequest?.destroy();
    this.tunnel?.destroy();
    super.destroy();
  }
}
