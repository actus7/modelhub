import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  detectTaskCategory: vi.fn(),
  findRoutingConfig: vi.fn(),
  getConfiguredRoutingProviderModelReadiness: vi.fn(),
}))

vi.mock("../db", () => ({
  prisma: {
    routingConfig: {
      findUnique: mocks.findRoutingConfig,
    },
    // O resolver agora consulta saúde observada; sem histórico ele roteia só
    // pela configuração, que é o cenário destes testes.
    usageLog: {
      groupBy: vi.fn(async () => []),
    },
  },
}))

vi.mock("./task-detector", () => ({
  detectTaskCategory: mocks.detectTaskCategory,
}))

vi.mock("./provider-readiness", () => ({
  getConfiguredRoutingProviderModelReadiness:
    mocks.getConfiguredRoutingProviderModelReadiness,
}))

const { invalidateRoutingCache, resolveRouting } =
  await import("./routing-resolver")

describe("resolveRouting fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConfiguredRoutingProviderModelReadiness.mockResolvedValue({
      providerIds: new Set([
        "anthropic",
        "mistral",
        "deepseek",
        "groq",
        "openai",
      ]),
      modelKeys: new Set([
        "anthropic/claude-sonnet",
        "mistral/codestral-latest",
        "deepseek/deepseek-coder",
        "groq/",
        "groq/llama-8b",
        "openai/gpt-main",
        "openai/o3-mini",
      ]),
    })
    invalidateRoutingCache("user-1")
  })

  it("prioritizes explicit tier fallbacks before the automatic tier pool", async () => {
    mocks.findRoutingConfig.mockResolvedValueOnce({
      complexityEnabled: false,
      taskRoutingEnabled: false,
      tiers: {
        simple: {
          providerId: "openai",
          modelId: "gpt-main",
          fallbacks: [
            { providerId: "openai", modelId: "gpt-main" },
            { providerId: "anthropic", modelId: "claude-sonnet" },
            { providerId: "groq", modelId: "" },
          ],
        },
        standard: { providerId: "openai", modelId: "gpt-main" },
        reasoning: { providerId: "openai", modelId: "o3-mini" },
      },
      taskOverrides: {},
    })

    const result = await resolveRouting({
      forcedTier: "simple",
      messages: [{ role: "user", content: "hello" }],
      userId: "user-1",
    })

    expect(result).toMatchObject({
      providerId: "openai",
      modelId: "gpt-main",
      tier: "simple",
    })
    expect(result?.fallbacks).toEqual([
      { providerId: "anthropic", modelId: "claude-sonnet", tier: "simple" },
      { providerId: "groq", modelId: "", tier: "simple" },
      { providerId: "openai", modelId: "o3-mini", tier: "reasoning" },
    ])
  })

  it("uses explicit task-category fallbacks before tier fallbacks", async () => {
    mocks.detectTaskCategory.mockReturnValueOnce({
      category: "coding",
      confidence: 0.9,
    })
    mocks.findRoutingConfig.mockResolvedValueOnce({
      complexityEnabled: true,
      taskRoutingEnabled: true,
      tiers: {
        simple: { providerId: "groq", modelId: "llama-8b" },
      },
      taskOverrides: {
        coding: {
          providerId: "mistral",
          modelId: "codestral-latest",
          fallbacks: [{ providerId: "deepseek", modelId: "deepseek-coder" }],
        },
      },
    })

    const result = await resolveRouting({
      messages: [{ role: "user", content: "write code" }],
      userId: "user-1",
    })

    expect(result).toMatchObject({
      providerId: "mistral",
      modelId: "codestral-latest",
      reason: "task_specific",
      taskCategory: "coding",
    })
    expect(result?.fallbacks).toEqual([
      { providerId: "deepseek", modelId: "deepseek-coder", tier: "default" },
      { providerId: "groq", modelId: "llama-8b", tier: "simple" },
    ])
  })

  it("ignores configured assignments and fallbacks whose providers are not ready", async () => {
    mocks.getConfiguredRoutingProviderModelReadiness.mockResolvedValueOnce({
      providerIds: new Set(["groq", "openai"]),
      modelKeys: new Set(["groq/llama-8b", "openai/gpt-main"]),
    })
    mocks.findRoutingConfig.mockResolvedValueOnce({
      complexityEnabled: false,
      taskRoutingEnabled: false,
      tiers: {
        simple: { providerId: "stale", modelId: "old-model" },
        standard: {
          providerId: "openai",
          modelId: "gpt-main",
          fallbacks: [
            { providerId: "anthropic", modelId: "claude-sonnet" },
            { providerId: "groq", modelId: "llama-8b" },
          ],
        },
      },
      taskOverrides: {},
    })

    const result = await resolveRouting({
      forcedTier: "standard",
      messages: [{ role: "user", content: "hello" }],
      userId: "user-1",
    })

    expect(result).toMatchObject({
      providerId: "openai",
      modelId: "gpt-main",
      tier: "standard",
    })
    expect(result?.fallbacks).toEqual([
      { providerId: "groq", modelId: "llama-8b", tier: "standard" },
    ])
  })
})
