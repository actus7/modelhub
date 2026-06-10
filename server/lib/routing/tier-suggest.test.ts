import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryMocks = vi.hoisted(() => ({
  getProviderModels: vi.fn(),
  isProviderAvailableViaExternalApi: vi.fn(() => true),
}))

vi.mock('../../providers/registry', () => ({
  getProviderModels: registryMocks.getProviderModels,
  isProviderAvailableViaExternalApi: registryMocks.isProviderAvailableViaExternalApi,
  providerRegistry: {
    anthropic: {},
    groq: {},
    openai: {},
  },
}))

vi.mock('../catalog', () => ({
  isProviderEnabled: vi.fn(() => true),
}))

vi.mock('../openrouter-pricing', () => ({
  ensureOpenRouterPricingFresh: vi.fn(),
  getOpenRouterPrice: vi.fn(() => null),
}))

import { capabilityScore, pickTiers, suggestTierAssignments, type ModelCandidate } from './tier-suggest'

beforeEach(() => {
  vi.clearAllMocks()
  registryMocks.getProviderModels.mockImplementation(async (providerId: string) => {
    if (providerId === 'groq') {
      return [{ capabilities: { documents: true, images: false }, id: 'llama-8b', name: 'Llama 8B' }]
    }
    if (providerId === 'openai') {
      return [{ capabilities: { documents: true, images: false }, id: 'o3', name: 'o3' }]
    }
    return []
  })
})

describe('capabilityScore', () => {
  it('dá score maior a modelos topo de linha que a modelos pequenos', () => {
    expect(capabilityScore('anthropic', 'claude-opus-4-8')).toBeGreaterThan(
      capabilityScore('anthropic', 'claude-haiku-4-5'),
    )
  })

  it('bonifica modelos de raciocínio explícito', () => {
    expect(capabilityScore('openai', 'o3-mini')).toBeGreaterThan(capabilityScore('openai', 'gpt-4o-mini'))
  })

  it('usa preço mid quando o modelo é desconhecido', () => {
    expect(capabilityScore('unknown', 'mystery-model')).toBe(5)
  })
})

describe('pickTiers', () => {
  it('retorna vazio sem candidatos', () => {
    expect(pickTiers([])).toEqual({})
  })

  it('mapeia o mais barato para simple e o mais capaz para reasoning', () => {
    const candidates: ModelCandidate[] = [
      { providerId: 'groq', modelId: 'llama-3.1-8b-instant', score: 0.08, isReasoning: false },
      { providerId: 'openai', modelId: 'gpt-4o-mini', score: 0.6, isReasoning: false },
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', score: 15, isReasoning: false },
      { providerId: 'openai', modelId: 'o3', score: 90, isReasoning: true },
    ]
    const tiers = pickTiers(candidates)
    expect(tiers.simple).toEqual({ providerId: 'groq', modelId: 'llama-3.1-8b-instant' })
    expect(tiers.reasoning).toEqual({ providerId: 'openai', modelId: 'o3' })
  })

  it('prefere modelo de raciocínio para reasoning mesmo sem ser o de maior score', () => {
    const candidates: ModelCandidate[] = [
      { providerId: 'groq', modelId: 'llama-8b', score: 0.1, isReasoning: false },
      { providerId: 'deepseek', modelId: 'deepseek-reasoner', score: 50, isReasoning: true },
      { providerId: 'anthropic', modelId: 'claude-opus', score: 75, isReasoning: false },
    ]
    const tiers = pickTiers(candidates)
    expect(tiers.reasoning).toEqual({ providerId: 'deepseek', modelId: 'deepseek-reasoner' })
  })

  it('funciona com um único candidato (todos os tiers iguais)', () => {
    const candidates: ModelCandidate[] = [
      { providerId: 'groq', modelId: 'llama', score: 1, isReasoning: false },
    ]
    const tiers = pickTiers(candidates)
    expect(tiers.simple).toEqual({ providerId: 'groq', modelId: 'llama' })
    expect(tiers.reasoning).toEqual({ providerId: 'groq', modelId: 'llama' })
  })
})

describe('suggestTierAssignments', () => {
  it('sugere tiers apenas a partir das fontes configuradas', async () => {
    const tiers = await suggestTierAssignments({
      sources: [
        {
          cacheKeySuffix: 'user-1:groq',
          credentials: { GROQ_API_KEY: 'sk-test' },
          providerId: 'groq',
        },
      ],
    })

    expect(registryMocks.getProviderModels).toHaveBeenCalledTimes(1)
    expect(registryMocks.getProviderModels).toHaveBeenCalledWith('groq', {
      cacheKeySuffix: 'user-1:groq',
      credentials: { GROQ_API_KEY: 'sk-test' },
    })
    expect(Object.values(tiers).every((assignment) => assignment?.providerId === 'groq')).toBe(true)
  })
})
