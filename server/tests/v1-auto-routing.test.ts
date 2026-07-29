import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  providerHandler: vi.fn(),
  resolveRouting: vi.fn(),
}))

vi.mock('../lib/catalog', () => ({
  isProviderEnabled: vi.fn(() => true),
}))

vi.mock('../lib/db', () => ({
  prisma: {
    apiKey: { findFirst: vi.fn(), update: vi.fn().mockReturnValue({ catch: vi.fn() }) },
    user: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/auth/server', () => ({
  auth: { getSession: mocks.getSession },
}))

vi.mock('../lib/routing/routing-resolver', () => ({
  resolveRouting: mocks.resolveRouting,
}))

vi.mock('../lib/routing/fallback', () => ({
  isInCooldown: vi.fn(() => false),
  recordCooldown: vi.fn(),
  shouldTriggerFallback: vi.fn(() => false),
}))

vi.mock('../providers/registry', () => ({
  getProviderModels: vi.fn(),
  isProviderAvailableViaExternalApi: vi.fn(() => true),
  providerRegistry: {
    demo: {
      handler: mocks.providerHandler,
      models: [],
    },
  },
}))

const v1Fetch = (await import('../routes/v1')).default

describe('POST /v1/chat/completions auto routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      data: {
        session: { id: 'session-1' },
        user: { email: 'user@example.com', id: 'user-1', name: 'User' },
      },
    })
    mocks.resolveRouting.mockResolvedValue({
      confidence: 0.92,
      fallbacks: [],
      modelId: 'demo-model',
      providerId: 'demo',
      reason: 'complexity',
      taskCategory: null,
      tier: 'standard',
    })
    mocks.providerHandler.mockResolvedValue(new Response('0:" routed"\nd:{"finishReason":"stop"}\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      status: 200,
    }))
  })

  it('authenticates the web session and dispatches the model selected by routing', async () => {
    const response = await v1Fetch(new Request('https://modelhub.test/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'auto',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    expect(mocks.resolveRouting).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ content: 'hello', role: 'user' }],
      userId: 'user-1',
    }))

    const forwardedRequest = mocks.providerHandler.mock.calls[0]?.[0] as Request
    expect(new URL(forwardedRequest.url).pathname).toBe('/demo/api/chat')
    expect(await forwardedRequest.json()).toMatchObject({ modelId: 'demo-model' })

    expect(response.headers.get('X-ModelHub-Tier')).toBe('standard')
    expect(response.headers.get('X-ModelHub-Provider')).toBe('demo')
    expect(response.headers.get('X-ModelHub-Model')).toBe('demo-model')
    expect(await response.text()).toContain('routed')
  })

  it.each(['simple', 'standard', 'complex', 'reasoning'] as const)(
    'routes the forced %s lane through /v1/chat/completions',
    async (tier) => {
      mocks.resolveRouting.mockResolvedValueOnce({
        confidence: 1,
        fallbacks: [],
        modelId: `${tier}-model`,
        providerId: 'demo',
        reason: 'configured',
        taskCategory: null,
        tier,
      })

      const response = await v1Fetch(new Request('https://modelhub.test/v1/chat/completions', {
        body: JSON.stringify({
          messages: [{ content: `test ${tier}`, role: 'user' }],
          model: `${tier}:auto`,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }))

      expect(response.status).toBe(200)
      expect(mocks.resolveRouting).toHaveBeenLastCalledWith(expect.objectContaining({ forcedTier: tier }))

      const forwardedRequest = mocks.providerHandler.mock.calls.at(-1)?.[0] as Request
      expect(await forwardedRequest.json()).toMatchObject({ modelId: `${tier}-model` })
      expect(response.headers.get('X-ModelHub-Tier')).toBe(tier)
      expect(response.headers.get('X-ModelHub-Model')).toBe(`${tier}-model`)
    },
  )
})
