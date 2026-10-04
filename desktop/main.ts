import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  safeStorage,
  type IpcMainInvokeEvent,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { readFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { resolve, join, sep, extname } from "node:path";
import { ConnectionStore } from "./store.js";
import { HistoryStore } from "./history.js";
import { DesktopService } from "./service.js";
import { ConnectionError } from "./network.js";
import type { Result } from "../shared/desktop.js";

app.setName("Qiban");
app.setPath("userData", join(app.getPath("appData"), "Qiban"));
if (!app.isPackaged && process.env.QIBAN_TEST_USER_DATA)
  app.setPath("userData", resolve(process.env.QIBAN_TEST_USER_DATA));
if (process.argv.includes("--squirrel-uninstall")) {
  try {
    rmSync(app.getPath("userData"), {
      recursive: true,
      force: true,
      maxRetries: 2,
    });
  } catch {}
}
const startup = Boolean(squirrelStartup);
const locked = startup ? false : app.requestSingleInstanceLock();
if (!locked) app.quit();
const APP_URL = "qiban://app/index.html";
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "qiban",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | undefined;
let service: DesktopService | undefined;
app.on("second-instance", () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => service?.cancelAll());

if (locked)
  app
    .whenReady()
    .then(async () => {
      const renderer = resolve(__dirname, "renderer");
      protocol.handle("qiban", async (req) => {
        const url = new URL(req.url);
        let path: string;
        try {
          path = decodeURIComponent(url.pathname);
        } catch {
          return new Response("", { status: 400 });
        }
        const file = resolve(renderer, `.${path}`);
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
        };
        if (
          req.method !== "GET" ||
          url.host !== "app" ||
          !file.startsWith(renderer + sep) ||
          path.split("/").some((part) => part.startsWith(".")) ||
          !mime[extname(file)]
        )
          return new Response("", { status: 403 });
        try {
          return new Response(await readFile(file), {
            headers: {
              "Content-Type": mime[extname(file)],
              "Content-Security-Policy": CSP,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("", { status: 404 });
        }
      });
      const directory = app.getPath("userData");
      const store = new ConnectionStore(directory, {
        isEncryptionAvailable: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text"),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value),
      });
      const history = new HistoryStore(directory);
      service = new DesktopService(store);
      function trusted(event: IpcMainInvokeEvent) {
        return (
          window &&
          event.sender === window.webContents &&
          event.senderFrame === window.webContents.mainFrame &&
          event.senderFrame.url === APP_URL
        );
      }
      function handle<T>(
        channel: string,
        action: (...args: any[]) => T | Promise<T>,
      ) {
        ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
          if (!trusted(event))
            return { ok: false, error: "此操作只能在栖伴窗口中进行。" };
          try {
            return { ok: true, value: await action(...args) };
          } catch (error) {
            return {
              ok: false,
              error:
                error instanceof ConnectionError
                  ? error.message
                  : "这次操作未能完成，请稍后重试。",
            };
          }
        });
      }
      handle("connection:status", () => service!.status());
      handle("connection:connect", (input) => service!.connect(input));
      handle("connection:model", (model) => service!.selectModel(model));
      handle("connection:demo", () => service!.demo());
      handle("connection:delete-key", () => service!.deleteKey());
      handle("history:load", () => history.load());
      handle("history:save", (value) => history.save(value));
      handle("data:path", () => directory);
      handle("diagnostics", () => ({
        schema_version: 1,
        app_version: app.getVersion(),
        platform: process.platform,
        mode: service!.status().mode,
        key_configured: service!.status().hasKey,
        key_retained: service!.status().remembered,
      }));
      handle("data:delete", async () => {
        service!.deleteData();
        history.clear();
        await window!.webContents.session.clearStorageData();
        await window!.webContents.session.clearCache();
      });
      handle("chat", (request, id) => service!.chat(request, id));
      ipcMain.on("chat:cancel", (event, id) => {
        if (
          trusted(event) &&
          typeof id === "string" &&
          /^[a-z0-9-]{1,64}$/i.test(id)
        )
          service!.cancel(id);
      });
      window = new BrowserWindow({
        width: 1200,
        height: 850,
        minWidth: 800,
        minHeight: 620,
        show: false,
        title: "栖伴 Qiban",
        backgroundColor: "#f7f5ef",
        autoHideMenuBar: true,

        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.once("ready-to-show", () => window!.show());
      await window.loadURL(APP_URL);
    })
    .catch(() => {
      app.exit(1);
    });
