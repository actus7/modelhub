import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearOpenRouterPricing, ensureOpenRouterPricingFresh, getOpenRouterPrice } from './openrouter-pricing'

afterEach(() => {
  clearOpenRouterPricing()
  vi.restoreAllMocks()
})

const FAKE_MODELS = {
  data: [
    { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
    { id: 'x-ai/grok-4', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'moonshotai/kimi-k2-0711-preview', pricing: { prompt: '0.0000006', completion: '0.0000025' } },
    { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
    { id: 'bad/model', pricing: { prompt: 'x', completion: 'y' } },
  ],
}

function mockFetchOk() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => FAKE_MODELS,
  }))
}

describe('openrouter-pricing', () => {
  it('retorna null antes de carregar o cache', () => {
    expect(getOpenRouterPrice('openai', 'gpt-4o')).toBeNull()
  })

  it('busca e indexa preços por providerId direto (USD/1M)', async () => {
    mockFetchOk()
    await ensureOpenRouterPricingFresh()
    expect(getOpenRouterPrice('openai', 'gpt-4o')).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
  })

  it('mapeia vendor do OpenRouter para o providerId do ModelHub (x-ai → xai)', async () => {
    mockFetchOk()
    await ensureOpenRouterPricingFresh()
    expect(getOpenRouterPrice('xai', 'grok-4')).toEqual({ inputPer1M: 3, outputPer1M: 15 })
    expect(getOpenRouterPrice('moonshot', 'kimi-k2-0711-preview')).toEqual({ inputPer1M: 0.6, outputPer1M: 2.5 })
  })

  it('indexa gateways pelo id completo vendor/model', async () => {
    mockFetchOk()
    await ensureOpenRouterPricingFresh()
    expect(getOpenRouterPrice('openrouter', 'openai/gpt-4o')).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
  })

  it('ignora entradas com pricing inválido', async () => {
    mockFetchOk()
    await ensureOpenRouterPricingFresh()
    expect(getOpenRouterPrice('bad', 'model')).toBeNull()
  })

  it('respeita o TTL e não rebusca dentro da janela', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => FAKE_MODELS })
    vi.stubGlobal('fetch', fetchMock)
    await ensureOpenRouterPricingFresh(1_000_000)
    await ensureOpenRouterPricingFresh(1_000_000 + 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
