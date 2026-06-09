import { afterEach, describe, expect, it } from 'vitest'

import {
  clearCooldowns,
  getCooldownRemaining,
  isInCooldown,
  recordCooldown,
  shouldTriggerFallback,
} from './fallback'

afterEach(() => clearCooldowns())

describe('shouldTriggerFallback', () => {
  it('não faz fallback em erros de request do cliente', () => {
    expect(shouldTriggerFallback(400)).toBe(false)
    expect(shouldTriggerFallback(422)).toBe(false)
  })

  it('faz fallback em 429, 5xx e demais 4xx de provider', () => {
    expect(shouldTriggerFallback(429)).toBe(true)
    expect(shouldTriggerFallback(500)).toBe(true)
    expect(shouldTriggerFallback(503)).toBe(true)
    expect(shouldTriggerFallback(401)).toBe(true)
    expect(shouldTriggerFallback(404)).toBe(true)
  })

  it('não faz fallback em sucesso', () => {
    expect(shouldTriggerFallback(200)).toBe(false)
    expect(shouldTriggerFallback(204)).toBe(false)
  })
})

describe('cooldown de rate-limit', () => {
  it('ignora status diferente de 429', () => {
    recordCooldown('groq', 'llama-3.3-70b', 500, null)
    expect(isInCooldown('groq', 'llama-3.3-70b')).toBe(false)
  })

  it('registra cooldown default de 60s em 429 sem retry-after', () => {
    const now = 1_000_000
    recordCooldown('groq', 'llama-3.3-70b', 429, null, now)
    expect(getCooldownRemaining('groq', 'llama-3.3-70b', now)).toBe(60_000)
    expect(isInCooldown('groq', 'llama-3.3-70b', now + 59_000)).toBe(true)
    expect(isInCooldown('groq', 'llama-3.3-70b', now + 61_000)).toBe(false)
  })

  it('respeita retry-after em segundos', () => {
    const now = 1_000_000
    recordCooldown('openai', 'gpt-4o', 429, '30', now)
    expect(getCooldownRemaining('openai', 'gpt-4o', now)).toBe(30_000)
  })

  it('limita retry-after ao máximo de 5min', () => {
    const now = 1_000_000
    recordCooldown('openai', 'gpt-4o', 429, '9999', now)
    expect(getCooldownRemaining('openai', 'gpt-4o', now)).toBe(5 * 60_000)
  })

  it('é case-insensitive na chave provider/modelo', () => {
    const now = 1_000_000
    recordCooldown('OpenAI', 'GPT-4o', 429, '30', now)
    expect(isInCooldown('openai', 'gpt-4o', now)).toBe(true)
  })

  it('expira e limpa a entrada', () => {
    const now = 1_000_000
    recordCooldown('groq', 'llama', 429, '10', now)
    expect(getCooldownRemaining('groq', 'llama', now + 11_000)).toBe(0)
  })
})
