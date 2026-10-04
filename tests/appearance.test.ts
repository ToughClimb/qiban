import test from "node:test";
import assert from "node:assert/strict";
import { accentPalette, APPEARANCE_KEY, DEFAULT_ACCENT, normalizeAccent, readAccent } from "../src/appearance.ts";

function luminance(color: string) {
  const linear = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
test("accent choices remain readable across light, saturated and dark colors", () => {
  for (const red of [0, 51, 102, 153, 204, 255])
    for (const green of [0, 51, 102, 153, 204, 255])
      for (const blue of [0, 51, 102, 153, 204, 255]) {
        const input = "#" + [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("");
        const palette = accentPalette(input);
        for (const color of Object.values(palette)) assert.match(color, /^#[0-9a-f]{6}$/);
        assert.ok(contrast(palette["--accent"], "#faf9f5") >= 4.5);
        assert.ok(contrast(palette["--accent"], palette["--accent-tint"]) >= 4.5);
        assert.ok(contrast("#fffefa", palette["--accent-hover"]) >= 4.5);
        assert.ok(contrast("#29342e", palette["--accent-soft"]) >= 4.5);
        assert.ok(contrast("#29342e", palette["--accent-selection"]) >= 4.5);
      }
});
test("default accent retains the approved colors; arbitrary CSS is rejected", () => {
  assert.equal(accentPalette(DEFAULT_ACCENT)["--accent-selection"], "#e4e8dc");
  assert.equal(accentPalette(DEFAULT_ACCENT)["--accent-hover"], "#2d4939");
  assert.equal(normalizeAccent("#ABCDEF"), "#abcdef");
  for (const value of ["red", "#fff", "url(https://example.invalid)", "#ffffff;--ink:red", null, {}, "#gggggg"])
    assert.equal(normalizeAccent(value), DEFAULT_ACCENT);
});
test("appearance reads only bounded versioned data and tolerates unavailable storage", () => {
  assert.equal(readAccent({ getItem: (key) => {
    assert.equal(key, APPEARANCE_KEY);
    return '{"version":1,"accent":"#46618a"}';
  } }), "#46618a");
  for (const raw of [null, "{bad", "null", '{"version":2,"accent":"#46618a"}', '{"version":1,"accent":"red"}', "x".repeat(129)])
    assert.equal(readAccent({ getItem: () => raw }), DEFAULT_ACCENT);
  assert.equal(readAccent({ getItem: () => { throw Error("blocked"); } }), DEFAULT_ACCENT);
});
