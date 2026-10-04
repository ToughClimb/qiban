import { BrowserWindow } from "electron";
import { imageError } from "./image-format.js";

// Chromium decodes WebP as well as PNG/JPEG. This isolated, temporary document
// has no preload, persistent session or network access and receives only bytes.
export async function decodeAvatar(bytes: Buffer, mime: string): Promise<Buffer> {
  const decoder = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      partition: "avatar-decoder",
    },
  });
  decoder.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  decoder.webContents.on("will-navigate", (event) => event.preventDefault());
  decoder.webContents.session.setPermissionRequestHandler((_web, _permission, done) => done(false));
  decoder.webContents.session.setPermissionCheckHandler(() => false);
  const timer = setTimeout(() => decoder.destroy(), 5000);
  try {
    await decoder.loadURL("data:text/html,<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob: data:; base-uri 'none'; object-src 'none'\">");
    const data = JSON.stringify({ base64: bytes.toString("base64"), mime });
    const png: string = await decoder.webContents.executeJavaScript(`(async ({base64, mime}) => {
      const raw = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([raw], {type: mime}));
      if (!image.width || !image.height || image.width > 4096 || image.height > 4096) {
        image.close(); throw new Error('Invalid dimensions');
      }
      const scale = Math.min(1, 512 / image.width, 512 / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    })(${data})`);
    return Buffer.from(png, "base64");
  } catch {
    return imageError();
  } finally {
    clearTimeout(timer);
    if (!decoder.isDestroyed()) decoder.destroy();
  }
}
