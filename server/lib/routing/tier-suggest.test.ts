import { beforeEach, describe, expect, it, vi } from "vitest"

const registryMocks = vi.hoisted(() => ({
  getProviderModels: vi.fn(),
  isProviderAvailableViaExternalApi: vi.fn(() => true),
}))

vi.mock("../../providers/registry", () => ({
  getProviderModels: registryMocks.getProviderModels,
  isProviderAvailableViaExternalApi:
    registryMocks.isProviderAvailableViaExternalApi,
  providerRegistry: {
    anthropic: {},
    groq: {},
    openai: {},
  },
}))

vi.mock("../catalog", () => ({
  isProviderEnabled: vi.fn(() => true),
}))

vi.mock("../openrouter-pricing", () => ({
  ensureOpenRouterPricingFresh: vi.fn(),
  getOpenRouterPrice: vi.fn(() => null),
}))

import {
  fillLane,
  isChatModel,
  paramBillions,
  pickTiers,
  scoreModel,
  suggestTierAssignments,
  type ModelCandidate,
} from "./tier-suggest"

const candidate = (
  providerId: string,
  modelId: string,
  overrides: Partial<ModelCandidate> = {},
): ModelCandidate => ({
  providerId,
  modelId,
  score: 50,
  isReasoning: false,
  outputPer1M: null,
  signals: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  registryMocks.getProviderModels.mockImplementation(
    async (providerId: string) => {
      if (providerId === "groq") {
        return [
          {
            capabilities: { documents: true, images: false },
            id: "llama-3.1-8b-instant",
            name: "Llama 8B",
          },
          {
            capabilities: { documents: true, images: false },
            id: "llama-guard-3-8b",
            name: "Llama Guard",
          },
        ]
      }
      if (providerId === "openai") {
        return [
          {
            capabilities: { documents: true, images: false },
            id: "o3",
            name: "o3",
          },
        ]
      }
      return []
    },
  )
})

describe("paramBillions", () => {
  it("lê a contagem de parâmetros dos identificadores reais dos catálogos", () => {
    expect(paramBillions("@cf/meta/llama-3.2-3b-instruct")).toBe(3)
    expect(paramBillions("gpt-oss-120b")).toBe(120)
    expect(paramBillions("gemma-4-31b")).toBe(31)
    expect(paramBillions("deepseek-r1-distill-qwen-32b")).toBe(32)
  })

  it("ignora sufixos numéricos que não são contagem de parâmetros", () => {
    // `fp8` não é "8b"; `4o` e `4.7` não têm o sufixo b.
    expect(paramBillions("llama-3.1-8b-instruct-fp8")).toBe(8)
    expect(paramBillions("gpt-4o")).toBeNull()
    expect(paramBillions("zai-glm-4.7")).toBeNull()
  })
})

describe("isChatModel", () => {
  it("descarta modelos que não atendem chat completions", () => {
    expect(isChatModel("@cf/meta/llama-guard-3-8b")).toBe(false)
    expect(isChatModel("@cf/google/gemma-2b-it-lora")).toBe(false)
    expect(isChatModel("text-embedding-3-large")).toBe(false)
    expect(isChatModel("@cf/openai/whisper")).toBe(false)
  })

  it("mantém modelos de chat", () => {
    expect(isChatModel("@cf/meta/llama-3.2-3b-instruct")).toBe(true)
    expect(isChatModel("gpt-oss-120b")).toBe(true)
  })
})

describe("scoreModel", () => {
  it("rankeia por contagem de parâmetros quando o preço é desconhecido", () => {
    // O caso que quebrava antes: sem preço na tabela, tudo empatava.
    const big = scoreModel("cerebras", "gpt-oss-120b").score
    const small = scoreModel(
      "cloudflare",
      "@cf/meta/llama-3.2-1b-instruct",
    ).score
    expect(big).toBeGreaterThan(small)
  })

  it("bonifica raciocínio explícito", () => {
    expect(scoreModel("openai", "o3-mini").score).toBeGreaterThan(
      scoreModel("openai", "gpt-4o-mini").score,
    )
    expect(scoreModel("openai", "o3").isReasoning).toBe(true)
  })

  it('não confunde "pro" dentro de outra palavra com família topo de linha', () => {
    expect(scoreModel("x", "prompt-tuned-thing").signals).toContain(
      "sem sinal no identificador",
    )
  })

  it("explica o motivo do score para o preview", () => {
    expect(scoreModel("cerebras", "gpt-oss-120b").signals).toContain(
      "120B parâmetros",
    )
  })
})

describe("fillLane", () => {
  it("prioriza providers distintos antes de repetir", () => {
    const pool = [
      candidate("groq", "a"),
      candidate("groq", "b"),
      candidate("cerebras", "c"),
    ]
    expect(fillLane(pool, 3).map((item) => item.modelId)).toEqual([
      "a",
      "c",
      "b",
    ])
  })

  it("respeita o limite de vagas", () => {
    const pool = [candidate("a", "1"), candidate("b", "2"), candidate("c", "3")]
    expect(fillLane(pool, 2)).toHaveLength(2)
  })
})

describe("pickTiers", () => {
  it("retorna vazio sem candidatos", () => {
    expect(pickTiers([])).toEqual({})
  })

  it("preenche a lane com principal + fallbacks", () => {
    const candidates = [
      candidate("groq", "llama-3.1-8b", { score: 48 }),
      candidate("cerebras", "gemma-4-31b", { score: 45 }),
      candidate("cloudflare", "mistral-7b", { score: 44 }),
    ]
    expect(pickTiers(candidates, 3).standard).toHaveLength(3)
  })

  it("coloca o modelo mais capaz da faixa como principal", () => {
    const candidates = [
      candidate("groq", "fraco", { score: 42 }),
      candidate("cerebras", "forte", { score: 60 }),
    ]
    expect(pickTiers(candidates, 2).standard?.[0]?.modelId).toBe("forte")
  })

  it("prefere modelo de raciocínio para reasoning mesmo com score menor", () => {
    const candidates = [
      candidate("deepseek", "deepseek-reasoner", {
        score: 68,
        isReasoning: true,
      }),
      candidate("anthropic", "claude-opus", { score: 93 }),
    ]
    const reasoning = pickTiers(candidates, 2).reasoning
    expect(reasoning?.map((slot) => slot.modelId)).toContain(
      "deepseek-reasoner",
    )
  })

  it("usa os candidatos mais próximos quando nenhuma faixa casa", () => {
    const candidates = [candidate("groq", "unico", { score: 50 })]
    const tiers = pickTiers(candidates, 3)
    // Um catálogo de um modelo só preenche todas as lanes com ele.
    expect(tiers.simple?.[0]?.modelId).toBe("unico")
    expect(tiers.reasoning?.[0]?.modelId).toBe("unico")
  })
})

describe("suggestTierAssignments", () => {
  it("sugere tiers apenas a partir das fontes configuradas", async () => {
    const tiers = await suggestTierAssignments({
      sources: [
        {
          cacheKeySuffix: "user-1:groq",
          credentials: { GROQ_API_KEY: "sk-test" },
          providerId: "groq",
        },
      ],
    })

    expect(registryMocks.getProviderModels).toHaveBeenCalledTimes(1)
    expect(registryMocks.getProviderModels).toHaveBeenCalledWith("groq", {
      cacheKeySuffix: "user-1:groq",
      credentials: { GROQ_API_KEY: "sk-test" },
    })
    const slots = Object.values(tiers).flat()
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot?.providerId === "groq")).toBe(true)
  })

  it("nunca sugere um modelo que não é de chat", async () => {
    const tiers = await suggestTierAssignments({
      sources: [
        { cacheKeySuffix: "user-1:groq", credentials: {}, providerId: "groq" },
      ],
    })

    const modelIds = Object.values(tiers)
      .flat()
      .map((slot) => slot?.modelId)
    expect(modelIds).not.toContain("llama-guard-3-8b")
  })
})
