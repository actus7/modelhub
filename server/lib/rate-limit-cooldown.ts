/**
 * Cooldown em memória para 429 de provedores upstream (padrão portado do
 * Manifest: packages/backend/src/routing/proxy/proxy-fallback.service.ts).
 *
 * Quando um provedor responde 429, registramos um período de cooldown por
 * (provedor, modelo) honrando o header Retry-After. Requisições seguintes
 * dentro da janela falham imediatamente sem martelar o upstream — o que
 * evita estender o rate limit e devolve feedback instantâneo ao usuário.
 */

const DEFAULT_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 5 * 60_000
const MAX_ENTRIES = 2_000

/** key → epoch ms até quando o cooldown vale */
const cooldowns = new Map<string, number>()

export function rateLimitCooldownKey(providerName: string, modelId: string): string {
  return `${providerName}:${modelId}`
}

/**
 * Interpreta o header Retry-After (segundos numéricos ou data HTTP).
 * Retorna null quando ausente/inválido.
 */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null

  const seconds = Number(header)
  if (Number.isFinite(seconds)) {
    // Valores numéricos negativos são inválidos (e Date.parse os leria como ano).
    return seconds >= 0 ? seconds * 1000 : null
  }

  const date = Date.parse(header)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now)
  }

  return null
}

/**
 * Registra um cooldown após um 429. Retorna a duração aplicada em ms
 * (Retry-After clampado a 5 min; default 60s quando ausente).
 */
export function recordRateLimit(key: string, retryAfterHeader?: string | null, now = Date.now()): number {
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now)
  const durationMs = Math.min(fromHeader ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS)

  if (cooldowns.size >= MAX_ENTRIES && !cooldowns.has(key)) {
    // Abre espaço removendo entradas expiradas; se nada expirou, descarta a mais antiga.
    for (const [k, until] of cooldowns) {
      if (until <= now) cooldowns.delete(k)
    }
    if (cooldowns.size >= MAX_ENTRIES) {
      const oldest = cooldowns.keys().next().value
      if (oldest !== undefined) cooldowns.delete(oldest)
    }
  }

  cooldowns.set(key, now + durationMs)
  return durationMs
}

/** Tempo restante de cooldown em ms (0 quando não há cooldown ativo). */
export function getCooldownRemainingMs(key: string, now = Date.now()): number {
  const until = cooldowns.get(key)
  if (until === undefined) return 0
  if (until <= now) {
    cooldowns.delete(key)
    return 0
  }
  return until - now
}

/** Limpa todos os cooldowns — apenas para testes. */
export function clearRateLimitCooldowns(): void {
  cooldowns.clear()
}
