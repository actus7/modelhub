import { afterEach, describe, expect, it } from 'vitest'

import {
  clearRateLimitCooldowns,
  getCooldownRemainingMs,
  parseRetryAfterMs,
  rateLimitCooldownKey,
  recordRateLimit,
} from './rate-limit-cooldown'

afterEach(() => {
  clearRateLimitCooldowns()
})

describe('parseRetryAfterMs', () => {
  it('interpreta segundos numéricos', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000)
  })

  it('interpreta data HTTP relativa ao agora', () => {
    const now = Date.parse('2026-06-10T12:00:00Z')
    const header = new Date(now + 90_000).toUTCString()
    const parsed = parseRetryAfterMs(header, now)
    // toUTCString trunca milissegundos
    expect(parsed).toBeGreaterThanOrEqual(89_000)
    expect(parsed).toBeLessThanOrEqual(90_000)
  })

  it('retorna null para ausente ou inválido', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs('garbage')).toBeNull()
    expect(parseRetryAfterMs('-5')).toBeNull()
  })
})

describe('recordRateLimit / getCooldownRemainingMs', () => {
  it('aplica default de 60s sem Retry-After', () => {
    const key = rateLimitCooldownKey('Groq', 'llama-3.3-70b')
    const applied = recordRateLimit(key, null, 1_000_000)
    expect(applied).toBe(60_000)
    expect(getCooldownRemainingMs(key, 1_000_000 + 30_000)).toBe(30_000)
  })

  it('honra Retry-After e clampa a 5 minutos', () => {
    const key = 'p:m'
    expect(recordRateLimit(key, '10', 0)).toBe(10_000)
    expect(recordRateLimit(key, '900', 0)).toBe(300_000)
  })

  it('expira o cooldown após a janela', () => {
    const key = 'p:m'
    recordRateLimit(key, '10', 0)
    expect(getCooldownRemainingMs(key, 5_000)).toBe(5_000)
    expect(getCooldownRemainingMs(key, 10_001)).toBe(0)
    // Segunda consulta confirma a remoção da entrada
    expect(getCooldownRemainingMs(key, 10_001)).toBe(0)
  })

  it('retorna 0 para chaves desconhecidas', () => {
    expect(getCooldownRemainingMs('desconhecida')).toBe(0)
  })
})
