import { request } from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { LookupAddress } from "node:dns";

export class ConnectionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function normalizeEndpoint(value: unknown): URL {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\\]/.test(value.trim())
  )
    throw new ConnectionError("url", "请填写有效的 HTTPS 服务地址。");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConnectionError(
      "url",
      "请填写完整地址，例如 https://api.deepseek.com。",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%2f|%5c|%00/i.test(url.pathname)
  )
    throw new ConnectionError(
      "url",
      "服务地址须使用 HTTPS，不能包含密钥、账号、查询参数或片段。",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new ConnectionError(
      "url",
      "此版本只连接公开的 HTTPS AI 服务，不连接本机或局域网地址。",
    );
  url.pathname =
    url.pathname.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") +
    "/";
  return url;
}
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export async function publicAddresses(
  hostname: string,
  resolver = lookup,
): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await resolver(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new ConnectionError(
      "url",
      "服务地址指向本机、局域网或保留地址，已停止连接。",
    );
  return addresses;
}
export type JsonTransport = (
  url: URL,
  key: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
export function createJsonTransport(
  resolveHost: (host: string) => Promise<LookupAddress[]> = publicAddresses,
  requester: typeof request = request,
): JsonTransport {
  return async (url, key, body, callerSignal) => {
    const signal = callerSignal
      ? AbortSignal.any([
          callerSignal,
          AbortSignal.timeout(body ? 25_000 : 10_000),
        ])
      : AbortSignal.timeout(body ? 25_000 : 10_000);
    let addresses: LookupAddress[];
    try {
      addresses = await new Promise((resolve, reject) => {
        const onAbort = () =>
          reject(
            new ConnectionError(
              callerSignal?.aborted ? "cancelled" : "timeout",
              callerSignal?.aborted
                ? "已取消这次连接。"
                : "连接超时，请检查网络或稍后重试。",
            ),
          );
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        resolveHost(url.hostname)
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", onAbort));
      });
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError(
        "network",
        "连接不上此服务，请检查地址和网络后重试。",
      );
    }
    const pinned = addresses.find((item) => item.family === 4) ?? addresses[0];
    return new Promise((resolve, reject) => {
      const req = requester(
        url,
        {
          method: body ? "POST" : "GET",
          agent: false,
          signal,
          family: pinned.family,
          lookup: (_host, _options, callback) =>
            callback(null, pinned.address, pinned.family),
          headers: {
            Authorization: `Bearer ${key}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          const status = res.statusCode ?? 500;
          if (status >= 300) {
            res.destroy();
            const error =
              status < 400
                ? new ConnectionError(
                    "redirect",
                    "服务要求跳转到其他地址。为保护密钥，连接已停止，请填写最终服务地址。",
                  )
                : status === 401 || status === 403
                  ? new ConnectionError(
                      "auth",
                      "密钥不正确或没有访问权限，请检查后重试。",
                    )
                  : status === 404 || status === 405
                    ? new ConnectionError(
                        body ? "unsupported" : "discovery",
                        body
                          ? "这个地址不支持聊天，请检查服务地址。"
                          : "此服务没有提供模型列表。",
                      )
                    : status === 429
                      ? new ConnectionError(
                          "rate",
                          "服务请求较多，请稍后再试。",
                        )
                      : new ConnectionError(
                          "unavailable",
                          "服务暂时不可用，请稍后重试。",
                        );
            reject(error);
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 128 * 1024) {
              res.destroy();
              reject(
                new ConnectionError("unsupported", "服务回复过大，无法读取。"),
              );
            } else chunks.push(chunk);
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(
                new ConnectionError(
                  "unsupported",
                  "服务没有返回兼容的数据，请检查地址。",
                ),
              );
            }
          });
          res.on("error", () =>
            reject(new ConnectionError("network", "连接中断，请稍后重试。")),
          );
        },
      );
      req.on("error", () =>
        reject(
          new ConnectionError(
            signal.aborted
              ? callerSignal?.aborted
                ? "cancelled"
                : "timeout"
              : "network",
            signal.aborted
              ? callerSignal?.aborted
                ? "已取消这次连接。"
                : "连接超时，请检查网络或稍后重试。"
              : "连接不上此服务，请检查地址和网络后重试。",
          ),
        ),
      );
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };
}
export const requestJson = createJsonTransport();
