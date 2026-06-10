/**
 * Parsing de variáveis de ambiente em formato CSV — fonte única usada por
 * env.ts (validação de startup), catalog.ts (ENABLED/DISABLED_PROVIDERS) e
 * security.ts (ALLOWED_ORIGINS). Antes eram 3 implementações independentes,
 * com risco de divergência entre validação e runtime.
 */

export function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Variante normalizada para identificadores case-insensitive (ex.: provider IDs). */
export function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(parseCsv(value).map((item) => item.toLowerCase()))
}
