import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const svg = await readFile("public/qiban.svg", "utf8");
  await page.setContent(
    `<style>body{margin:0;background:transparent}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true });
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile("build/qiban.ico", Buffer.concat([header, png]));
} finally {
  await browser.close();
}
