import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findRoutingConfig: vi.fn(),
  getConfiguredRoutingProviderModelReadiness: vi.fn(),
  getConfiguredRoutingProviderSources: vi.fn(),
  suggestTierAssignments: vi.fn(),
}))

vi.mock("../db", () => ({
  prisma: {
    routingConfig: {
      findUnique: mocks.findRoutingConfig,
    },
    usageLog: {
      groupBy: vi.fn(async () => []),
    },
  },
}))

vi.mock("./model-health", () => ({
  getModelHealth: vi.fn(async () => new Map()),
  healthKey: (providerId: string, modelId: string) => `${providerId}/${modelId}`,
  isUnhealthy: vi.fn(() => false),
}))

vi.mock("./provider-readiness", () => ({
  getConfiguredRoutingProviderModelReadiness:
    mocks.getConfiguredRoutingProviderModelReadiness,
  getConfiguredRoutingProviderSources: mocks.getConfiguredRoutingProviderSources,
}))

vi.mock("./tier-suggest", () => ({
  suggestTierAssignments: mocks.suggestTierAssignments,
}))

const { invalidateRoutingCache, resolveRouting } = await import(
  "./routing-resolver"
)

describe("resolveRouting sem config salva (auto default)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Conta nunca passou pelo /dashboard/routing.
    mocks.findRoutingConfig.mockResolvedValue(null)
    mocks.getConfiguredRoutingProviderModelReadiness.mockResolvedValue({
      providerIds: new Set<string>(),
      modelKeys: new Set<string>(),
    })
    invalidateRoutingCache("user-synthetic")
  })

  it("sintetiza tiers das sugestoes e roteia pelo default com reason auto_default", async () => {
    mocks.getConfiguredRoutingProviderSources.mockResolvedValue([
      { cacheKeySuffix: "user-synthetic:env", credentials: {}, providerId: "groq" },
      { cacheKeySuffix: "user-synthetic:h1", credentials: { X: "1" }, providerId: "openai" },
    ])
    mocks.suggestTierAssignments.mockResolvedValue({
      simple: [
        { modelId: "llama-8b", providerId: "groq", reason: "small" },
        { modelId: "gpt-main", providerId: "openai", reason: "mid" },
      ],
      standard: [{ modelId: "gpt-main", providerId: "openai", reason: "mid" }],
      reasoning: [
        { modelId: "o3-mini", providerId: "openai", reason: "reasoner" },
        { modelId: "llama-70b", providerId: "groq", reason: "large" },
      ],
    })

    const result = await resolveRouting({
      messages: [{ content: "oi", role: "user" }],
      userId: "user-synthetic",
    })

    // default = standard sintetizado
    expect(result).toMatchObject({
      modelId: "gpt-main",
      providerId: "openai",
      reason: "auto_default",
      tier: "default",
    })
    // Fallbacks derivados dos demais tiers sugeridos.
    expect(result?.fallbacks.length).toBeGreaterThan(0)
    expect(
      result?.fallbacks.some((f) => f.providerId === "groq"),
    ).toBe(true)
  })

  it("retorna null quando nao ha nenhum provider pronto (sem credenciais)", async () => {
    mocks.getConfiguredRoutingProviderSources.mockResolvedValue([])

    const result = await resolveRouting({
      messages: [{ content: "oi", role: "user" }],
      userId: "user-synthetic",
    })

    expect(result).toBeNull()
    expect(mocks.suggestTierAssignments).not.toHaveBeenCalled()
  })

  it("usa a config salva quando ela existe (nao sintetiza)", async () => {
    mocks.findRoutingConfig.mockResolvedValueOnce({
      complexityEnabled: false,
      taskRoutingEnabled: false,
      tiers: {
        default: { modelId: "saved-model", providerId: "saved" },
      },
      taskOverrides: {},
    })
    mocks.getConfiguredRoutingProviderModelReadiness.mockResolvedValueOnce({
      providerIds: new Set(["saved"]),
      modelKeys: new Set(["saved/saved-model"]),
    })

    const result = await resolveRouting({
      messages: [{ content: "oi", role: "user" }],
      userId: "user-synthetic",
    })

    expect(result).toMatchObject({
      modelId: "saved-model",
      providerId: "saved",
      reason: "config_default",
    })
    expect(mocks.getConfiguredRoutingProviderSources).not.toHaveBeenCalled()
  })
})
