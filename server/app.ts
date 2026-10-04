import express, { type ErrorRequestHandler } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_REQUEST_BYTES } from "../shared/chat.js";
import { parseChat } from "./validation.js";
import type { Config, Provider } from "./provider.js";

function tokenMatches(value: string | undefined, token: string): boolean {
  if (!value?.startsWith("Bearer ") || value.length > 1024) return false;
  const hash = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(value.slice(7)), hash(token));
}

export function createApp(config: Config, provider: Provider) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.get("/api/config", (_req, res) => res.json({ mode: config.mode }));
  let active = 0;
  const buckets = new Map<string, { count: number; expires: number }>();
  app.post(
    "/api/chat",
    (req, res, next) => {
      if (req.headers.origin) {
        try {
          if (new URL(req.headers.origin).host !== req.headers.host)
            return res.status(403).json({ error: "请从栖伴页面发起对话。" });
        } catch {
          return res.status(403).json({ error: "请从栖伴页面发起对话。" });
        }
      }
      if (
        config.mode === "live" &&
        !tokenMatches(req.headers.authorization, config.accessToken ?? "")
      ) {
        return res.status(401).json({ error: "体验口令不正确，请重新输入。" });
      }
      if (!req.is("application/json"))
        return res.status(415).json({ error: "消息格式不正确。" });
      const now = Date.now();
      for (const [key, bucket] of buckets)
        if (bucket.expires <= now) buckets.delete(key);
      // A shared live budget remains bounded even behind a proxy or across IPs.
      const key =
        config.mode === "live" ? "live" : (req.socket.remoteAddress ?? "local");
      const bucket = buckets.get(key) ?? { count: 0, expires: now + 60_000 };
      if (
        bucket.count >= 20 ||
        active >= 3 ||
        (!buckets.has(key) && buckets.size >= 1000)
      ) {
        res.set("Retry-After", "60");
        return res
          .status(429)
          .json({ error: "消息有点多，请稍等一分钟再试。" });
      }
      bucket.count += 1;
      buckets.set(key, bucket);
      next();
    },
    express.json({ limit: MAX_REQUEST_BYTES }),
    async (req, res) => {
      const request = parseChat(req.body);
      if (!request)
        return res
          .status(400)
          .json({ error: "消息太长或格式不正确，请缩短后再试。" });
      if (active >= 3) {
        res.set("Retry-After", "60");
        return res
          .status(429)
          .json({ error: "消息有点多，请稍等一分钟再试。" });
      }
      active += 1;
      const controller = new AbortController();
      const onClose = () => controller.abort();
      res.once("close", onClose);
      try {
        const content = await provider.reply(request, controller.signal);
        return res.json({ content, mode: config.mode });
      } catch {
        return res
          .status(502)
          .json({ error: "这次没能收到回复。你的消息还在，可以再试一次。" });
      } finally {
        active -= 1;
        res.off("close", onClose);
      }
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "找不到这个入口。" }),
  );
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === "entity.too.large" ? 413 : 400;
    res.status(status).json({
      error:
        status === 413
          ? "消息太长，请缩短后再试。"
          : "消息格式不正确，请再试一次。",
    });
  };
  app.use(onError);
  return app;
}
