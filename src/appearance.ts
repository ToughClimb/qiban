export const APPEARANCE_KEY = "qiban.appearance.v1";
export const DEFAULT_ACCENT = "#415d4d";
export const ACCENT_PRESETS = [
  { name: "松绿", color: DEFAULT_ACCENT },
  { name: "雾蓝", color: "#46618a" },
  { name: "莓红", color: "#915669" },
  { name: "暖棕", color: "#80623d" },
] as const;

const defaults = {
  "--accent": DEFAULT_ACCENT,
  "--accent-hover": "#2d4939",
  "--accent-soft": "#e7ecdf",
  "--accent-selection": "#e4e8dc",
  "--accent-navigation-hover": "#e8eae0",
  "--accent-tint": "#ecefe6",
  "--accent-border": "#adbba8",
};
const paper = "#faf9f5";

export function normalizeAccent(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_ACCENT;
}
function channels(color: string) {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}
function hex(values: number[]) {
  return "#" + values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("");
}
function mix(first: string, second: string, amount: number) {
  const other = channels(second);
  return hex(channels(first).map((value, index) => value * (1 - amount) + other[index] * amount));
}
function luminance(color: string) {
  const linear = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function accentPalette(value: unknown): Record<string, string> {
  let accent = normalizeAccent(value);
  if (accent === DEFAULT_ACCENT) return { ...defaults };
  // Preserve hue while making light choices readable on paper and tinted controls.
  while ((luminance(paper) + 0.05) / (luminance(accent) + 0.05) < 5.5)
    accent = mix(accent, "#000000", 0.05);
  return {
    "--accent": accent,
    "--accent-hover": mix(accent, "#000000", 0.16),
    "--accent-soft": mix(accent, paper, 0.91),
    "--accent-selection": mix(accent, paper, 0.89),
    "--accent-navigation-hover": mix(accent, paper, 0.93),
    "--accent-tint": mix(accent, paper, 0.95),
    "--accent-border": mix(accent, paper, 0.62),
  };
}

export function readAccent(storage: Pick<Storage, "getItem">): string {
  try {
    const raw = storage.getItem(APPEARANCE_KEY);
    if (!raw || raw.length > 128) return DEFAULT_ACCENT;
    const value = JSON.parse(raw);
    return value?.version === 1 ? normalizeAccent(value.accent) : DEFAULT_ACCENT;
  } catch { return DEFAULT_ACCENT; }
}
export function storedAccent(): string {
  try { return readAccent(localStorage); } catch { return DEFAULT_ACCENT; }
}
export function applyAccent(value: unknown) {
  for (const [property, color] of Object.entries(accentPalette(value)))
    document.documentElement.style.setProperty(property, color);
}
export function saveAccent(value: unknown): boolean {
  applyAccent(value);
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ version: 1, accent: normalizeAccent(value) }));
    return true;
  } catch { return false; }
}
export function clearAppearance() {
  try { localStorage.removeItem(APPEARANCE_KEY); } catch {}
  applyAccent(DEFAULT_ACCENT);
}

