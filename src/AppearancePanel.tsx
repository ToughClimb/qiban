import { useState, type CSSProperties } from "react";
import { ACCENT_PRESETS, normalizeAccent, saveAccent, storedAccent } from "./appearance";

export function AppearancePanel({ disabled = false }: { disabled?: boolean }) {
  const [accent, setAccent] = useState(storedAccent);
  const [saved, setSaved] = useState(true);
  function choose(value: string) {
    const color = normalizeAccent(value);
    setAccent(color);
    setSaved(saveAccent(color));
  }
  return (
    <details className="appearance-options">
      <summary>外观</summary>
      <div className="accent-options" aria-label="主题色">
        {ACCENT_PRESETS.map((preset) => (
          <button
            key={preset.color}
            className="accent-swatch"
            type="button"
            aria-label={`${preset.name}主题色`}
            aria-pressed={accent === preset.color}
            disabled={disabled}
            style={{ "--swatch": preset.color } as CSSProperties}
            onClick={() => choose(preset.color)}
          />
        ))}
        <label className="custom-accent">
          <span>自选</span>
          <input
            type="color"
            aria-label="自选主题色"
            value={accent}
            disabled={disabled}
            onChange={(event) => choose(event.target.value)}
          />
        </label>
      </div>
      {!saved && <p className="field-note" role="status">本次有效，暂时无法保存。</p>}
    </details>
  );
}
