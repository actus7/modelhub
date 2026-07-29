import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
}))

vi.mock("../db", () => ({
  prisma: { usageLog: { groupBy: prismaMocks.groupBy } },
}))

import {
  MIN_SAMPLE,
  clearModelHealthCache,
  getModelHealth,
  healthAdjustment,
  healthKey,
  isUnhealthy,
  type ModelHealth,
} from "./model-health"

const health = (overrides: Partial<ModelHealth> = {}): ModelHealth => ({
  total: 100,
  errors: 0,
  errorRate: 0,
  avgDurationMs: 800,
  lastErrorAt: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  clearModelHealthCache()
})

describe("getModelHealth", () => {
  it("cruza totais com falhas e calcula a taxa de erro", async () => {
    prismaMocks.groupBy
      .mockResolvedValueOnce([
        {
          providerId: "groq",
          modelId: "llama-8b",
          _count: { id: 10 },
          _avg: { durationMs: 900 },
        },
        {
          providerId: "cerebras",
          modelId: "gpt-oss-120b",
          _count: { id: 20 },
          _avg: { durationMs: 1500 },
        },
      ])
      .mockResolvedValueOnce([
        {
          providerId: "groq",
          modelId: "llama-8b",
          _count: { id: 6 },
          _max: { createdAt: new Date("2026-07-28T12:00:00Z") },
        },
      ])

    const result = await getModelHealth("user-1")

    expect(result.get(healthKey("groq", "llama-8b"))).toEqual({
      total: 10,
      errors: 6,
      errorRate: 0.6,
      avgDurationMs: 900,
      lastErrorAt: new Date("2026-07-28T12:00:00Z").getTime(),
    })
    // Modelo sem nenhuma falha registrada entra com taxa zero, não ausente.
    expect(result.get(healthKey("cerebras", "gpt-oss-120b"))?.errorRate).toBe(0)
  })

  it("ignora linhas sem modelId", async () => {
    prismaMocks.groupBy
      .mockResolvedValueOnce([
        {
          providerId: "groq",
          modelId: null,
          _count: { id: 3 },
          _avg: { durationMs: null },
        },
      ])
      .mockResolvedValueOnce([])

    expect((await getModelHealth("user-1")).size).toBe(0)
  })

  it("serve do cache dentro da janela de TTL", async () => {
    prismaMocks.groupBy.mockResolvedValue([])

    await getModelHealth("user-1")
    await getModelHealth("user-1")

    // Duas agregações na primeira chamada, nenhuma na segunda.
    expect(prismaMocks.groupBy).toHaveBeenCalledTimes(2)
  })
})

describe("isUnhealthy", () => {
  it("não condena modelo sem amostra suficiente", () => {
    // O caso perigoso: 1 request, 1 erro não é "100% quebrado", é desconhecido.
    expect(isUnhealthy(health({ total: 1, errors: 1, errorRate: 1 }))).toBe(
      false,
    )
    expect(isUnhealthy(undefined)).toBe(false)
  })

  it("condena modelo com amostra e maioria de erro", () => {
    expect(
      isUnhealthy(health({ total: MIN_SAMPLE, errors: 4, errorRate: 0.8 })),
    ).toBe(true)
  })

  it("mantém elegível quem erra pouco", () => {
    expect(
      isUnhealthy(health({ total: 100, errors: 10, errorRate: 0.1 })),
    ).toBe(false)
  })
})

describe("healthAdjustment", () => {
  it("fica neutro e se declara sem dados quando não há histórico", () => {
    expect(healthAdjustment(undefined)).toEqual({
      delta: 0,
      signal: "sem dados de uso",
    })
    expect(healthAdjustment(health({ total: 2 })).delta).toBe(0)
  })

  it("penaliza proporcionalmente à taxa de erro", () => {
    const bad = healthAdjustment(health({ total: 50, errorRate: 0.6 })).delta
    const meh = healthAdjustment(health({ total: 50, errorRate: 0.25 })).delta
    const ok = healthAdjustment(health({ total: 50, errorRate: 0.06 })).delta
    const good = healthAdjustment(health({ total: 50, errorRate: 0 })).delta

    expect(bad).toBeLessThan(meh)
    expect(meh).toBeLessThan(ok)
    expect(ok).toBeLessThan(good)
    expect(good).toBeGreaterThan(0)
  })

  it("explica o número por trás do ajuste", () => {
    expect(healthAdjustment(health({ total: 50, errorRate: 0.6 })).signal).toBe(
      "60% de erro em 50 req",
    )
  })
})
