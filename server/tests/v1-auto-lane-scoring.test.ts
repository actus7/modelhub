import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  providerHandler: vi.fn(),
  routingConfigFindUnique: vi.fn(),
}))

vi.mock('../lib/catalog', () => ({
  isProviderEnabled: vi.fn(() => true),
}))

vi.mock('../lib/db', () => ({
  prisma: {
    apiKey: { findFirst: vi.fn(), update: vi.fn().mockReturnValue({ catch: vi.fn() }) },
    providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
    routingConfig: { findUnique: mocks.routingConfigFindUnique },
    usageLog: {
      create: vi.fn().mockReturnValue({ catch: vi.fn() }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    user: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/auth/server', () => ({
  auth: { getSession: mocks.getSession },
}))

vi.mock('../lib/routing/provider-readiness', () => ({
  getConfiguredRoutingProviderModelReadiness: vi.fn().mockResolvedValue({
    modelKeys: new Set([
      'demo/simple-model',
      'demo/standard-model',
      'demo/complex-model',
      'demo/reasoning-model',
    ]),
    providerIds: new Set(['demo']),
  }),
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

const { invalidateRoutingCache } = await import('../lib/routing/routing-resolver')
const v1Fetch = (await import('../routes/v1')).default

const prompts = [
  ['simple', 'Olá tudo bem?'],
  ['standard', 'Compare REST e GraphQL para uma aplicação SaaS pequena. Dê prós, contras e recomendação.'],
  ['complex', 'Desenhe uma arquitetura para um gateway multi-provider de IA com autenticação, rate limit, fallback, logs de uso e dashboard. Liste componentes, fluxos e riscos.'],
  ['reasoning', 'Resolva passo a passo: tenho 3 provedores com custo, latência e taxa de erro diferentes. Como decidir dinamicamente qual modelo usar por tarefa, mantendo orçamento mensal e fallback seguro?'],
] as const

describe('POST /v1/chat/completions real auto lane scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateRoutingCache('user-1')
    mocks.getSession.mockResolvedValue({
      data: {
        session: { id: 'session-1' },
        user: { email: 'user@example.com', id: 'user-1', name: 'User' },
      },
    })
    mocks.routingConfigFindUnique.mockResolvedValue({
      complexityEnabled: true,
      taskOverrides: {},
      taskRoutingEnabled: false,
      tiers: {
        complex: { modelId: 'complex-model', providerId: 'demo' },
        reasoning: { modelId: 'reasoning-model', providerId: 'demo' },
        simple: { modelId: 'simple-model', providerId: 'demo' },
        standard: { modelId: 'standard-model', providerId: 'demo' },
      },
    })
    mocks.providerHandler.mockResolvedValue(new Response('0:" ok"\nd:{"finishReason":"stop"}\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      status: 200,
    }))
  })

  it.each(prompts)('routes chat parts prompt to %s lane', async (expectedTier, prompt) => {
    const response = await v1Fetch(new Request('https://modelhub.test/v1/chat/completions', {
      body: JSON.stringify({
        messages: [{ parts: [{ text: prompt, type: 'text' }], role: 'user' }],
        model: 'auto',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('X-ModelHub-Tier')).toBe(expectedTier)
    expect(response.headers.get('X-ModelHub-Model')).toBe(`${expectedTier}-model`)

    const forwardedRequest = mocks.providerHandler.mock.calls.at(-1)?.[0] as Request
    expect(await forwardedRequest.json()).toMatchObject({ modelId: `${expectedTier}-model` })
  })
})
