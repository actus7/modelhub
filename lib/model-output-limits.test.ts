import { describe, expect, it } from 'vitest'

import { inferMaxOutputTokens, resolveMaxOutputTokens } from './model-output-limits'

describe('model output limits', () => {
  it('uses model metadata when available', () => {
    expect(resolveMaxOutputTokens({ model: { maxOutputTokens: 12_000 } })).toBe(12_000)
  })

  it('clamps unsafe metadata', () => {
    expect(resolveMaxOutputTokens({ model: { maxOutputTokens: 100_000 } })).toBe(32_000)
  })

  it('infers known provider/model families', () => {
    expect(inferMaxOutputTokens('groq', 'llama-3.3-70b-versatile')).toBe(8_192)
    expect(inferMaxOutputTokens('openai', 'gpt-4o-mini')).toBe(16_384)
  })

  it('falls back to a safe default for unknown models', () => {
    expect(resolveMaxOutputTokens({ modelId: 'unknown', providerId: 'unknown' })).toBe(4_096)
  })
})
