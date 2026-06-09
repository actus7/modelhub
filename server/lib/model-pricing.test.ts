import { describe, expect, it } from 'vitest'
import { calculateCostUsd, getModelPrice } from './model-pricing'

describe('getModelPrice', () => {
  it('returns price for known openai model', () => {
    const price = getModelPrice('openai', 'gpt-4o')
    expect(price).not.toBeNull()
    expect(price?.inputPer1M).toBeGreaterThan(0)
    expect(price?.outputPer1M).toBeGreaterThan(0)
  })

  it('returns price for anthropic claude', () => {
    const price = getModelPrice('anthropic', 'claude-opus-4-8')
    expect(price).not.toBeNull()
  })

  it('returns null for unknown model', () => {
    const price = getModelPrice('openai', 'gpt-totally-fake-model-xyz')
    expect(price).toBeNull()
  })

  it('returns null for unknown provider', () => {
    const price = getModelPrice('unknown-provider-xyz', 'some-model')
    expect(price).toBeNull()
  })
})

describe('calculateCostUsd', () => {
  it('calculates cost correctly for gpt-4o-mini', () => {
    const cost = calculateCostUsd('openai', 'gpt-4o-mini', 1_000_000, 1_000_000)
    expect(cost).not.toBeNull()
    expect(cost).toBeGreaterThan(0)
  })

  it('returns null for unknown model', () => {
    const cost = calculateCostUsd('openai', 'fake-model', 1000, 500)
    expect(cost).toBeNull()
  })

  it('returns 0 cost for 0 tokens', () => {
    const cost = calculateCostUsd('openai', 'gpt-4o', 0, 0)
    expect(cost).toBe(0)
  })

  it('output tokens cost more than same input tokens for gpt-4o', () => {
    const inputCost = calculateCostUsd('openai', 'gpt-4o', 1_000_000, 0)
    const outputCost = calculateCostUsd('openai', 'gpt-4o', 0, 1_000_000)
    expect(inputCost).not.toBeNull()
    expect(outputCost).not.toBeNull()
    expect(outputCost!).toBeGreaterThan(inputCost!)
  })

  it('calculates google gemini flash cost', () => {
    const cost = calculateCostUsd('google', 'gemini-2.0-flash', 100_000, 50_000)
    expect(cost).not.toBeNull()
    expect(cost!).toBeGreaterThanOrEqual(0)
  })
})
