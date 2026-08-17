/**
 * Accent color presets shared between server (validation) and client (UI).
 *
 * "default" = tema atual (navy no claro, âmbar no escuro); nenhum atributo
 * `data-accent` é aplicado e o CSS permanece exatamente igual ao de hoje.
 */

export const ACCENT_COLOR_OPTIONS = [
  { id: "default", label: "Padrão" },
  { id: "blue", label: "Azul" },
  { id: "violet", label: "Violeta" },
  { id: "emerald", label: "Esmeralda" },
  { id: "orange", label: "Laranja" },
  { id: "rose", label: "Rosa" },
  { id: "teal", label: "Turquesa" },
] as const;

export type AccentColorId = (typeof ACCENT_COLOR_OPTIONS)[number]["id"];

export const ACCENT_COLOR_IDS: readonly string[] = ACCENT_COLOR_OPTIONS.map((o) => o.id);

export function isValidAccentColor(value: unknown): value is AccentColorId {
  return typeof value === "string" && ACCENT_COLOR_IDS.includes(value);
}

/**
 * Cor de amostragem (swatch) exibida na UI de seleção — espelha o
 * `--primary` de cada preset no modo claro.
 */
export const ACCENT_SWATCH: Record<AccentColorId, string> = {
  default: "oklch(0.2972 0.0398 246.6002)",
  blue: "oklch(0.546 0.245 262.881)",
  violet: "oklch(0.541 0.281 293.009)",
  emerald: "oklch(0.596 0.145 163.225)",
  orange: "oklch(0.646 0.222 41.116)",
  rose: "oklch(0.586 0.253 17.585)",
  teal: "oklch(0.6 0.118 184.704)",
};
