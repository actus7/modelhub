import { describe, expect, it } from "vitest";

import {
  ACCENT_COLOR_IDS,
  ACCENT_COLOR_OPTIONS,
  ACCENT_SWATCH,
  isValidAccentColor,
} from "./accent-colors";

describe("accent-colors", () => {
  it("oferece o default + 6 presets com labels em pt-BR", () => {
    expect(ACCENT_COLOR_OPTIONS.map((o) => o.id)).toEqual([
      "default",
      "blue",
      "violet",
      "emerald",
      "orange",
      "rose",
      "teal",
    ]);
    expect(ACCENT_COLOR_OPTIONS[0].label).toBe("Padrão");
  });

  it("valida apenas ids conhecidos", () => {
    expect(isValidAccentColor("default")).toBe(true);
    expect(isValidAccentColor("teal")).toBe(true);
    expect(isValidAccentColor("pink")).toBe(false);
    expect(isValidAccentColor("")).toBe(false);
    expect(isValidAccentColor(null)).toBe(false);
    expect(isValidAccentColor(1)).toBe(false);
  });

  it("mantém IDs e swatches consistentes", () => {
    for (const id of ACCENT_COLOR_IDS) {
      expect(ACCENT_SWATCH[id as keyof typeof ACCENT_SWATCH]).toMatch(/^oklch\(/);
    }
  });
});
