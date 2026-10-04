import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createProvider, readConfig } from "./provider.js";

const config = readConfig(process.env);
const app = createApp(config, createProvider(config));
if (process.env.NODE_ENV === "production") {
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(express.static(resolve("dist/client"), { dotfiles: "deny" }));
  app.get("/", (_req, res) => res.sendFile(resolve("dist/client/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () =>
  console.log(`Qiban is available at http://${host}:${port} (${config.mode})`),
);
