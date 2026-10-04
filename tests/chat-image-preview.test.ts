import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeChatImagePreview } from "../src/chatImageUrl";

test("chat previews accept bounded local raster data, never arbitrary URLs or SVG", () => {
  const image = readFileSync(new URL("./fixtures/chat-image.png", import.meta.url));
  const preview = `data:image/png;base64,${image.toString("base64")}`;
  assert.equal(safeChatImagePreview(preview), preview);
  for (const value of [
    "https://example.invalid/image.png", "file:///private/image.png", "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+", "data:text/html;base64,PHN2Zy8+", "data:image/png;base64,abc",
    "data:image/png;base64,====", "data:image/png;base64,", {}, null,
    `data:image/png;base64,${"A".repeat(1_400_000)}`,
  ]) assert.equal(safeChatImagePreview(value), null);
});
