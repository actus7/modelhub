import { describe, expect, it } from "vitest"

import type { RoutingModelOption } from "@/lib/contracts"

import {
  MAX_SLOTS_PER_TIER,
  appendSlot,
  cleanModelName,
  healthBadge,
  costBand,
  formatPricePer1M,
  moveSlot,
  replaceSlot,
  toAssignment,
  toSlots,
} from "./routing-utils"

const slot = (providerId: string, modelId: string) => ({ providerId, modelId })

const model = (
  overrides: Partial<{
    inputPer1M: number | null
    outputPer1M: number | null
  }> = {},
) => ({
  providerId: "openai",
  providerLabel: "OpenAI",
  modelId: "gpt-4o",
  modelName: "GPT-4o",
  inputPer1M: 2.5 as number | null,
  outputPer1M: 10 as number | null,
  health: null as RoutingModelOption["health"],
  ...overrides,
})

describe("toSlots / toAssignment", () => {
  it("returns an empty list when the tier has no primary model", () => {
    expect(toSlots(undefined)).toEqual([])
    expect(toSlots({ providerId: "", modelId: "" })).toEqual([])
  })

  it("flattens primary + fallbacks into one ordered list", () => {
    const slots = toSlots({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      fallbacks: [slot("groq", "llama-3.1-8b")],
    })

    expect(slots).toEqual([
      slot("openai", "gpt-4o-mini"),
      slot("groq", "llama-3.1-8b"),
    ])
  })

  it("round-trips back into the API shape, omitting empty fallbacks", () => {
    expect(toAssignment([slot("openai", "gpt-4o")])).toEqual({
      providerId: "openai",
      modelId: "gpt-4o",
    })
    expect(toAssignment([])).toBeUndefined()
    expect(
      toAssignment([slot("openai", "gpt-4o"), slot("groq", "llama")]),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-4o",
      fallbacks: [slot("groq", "llama")],
    })
  })
})

describe("moveSlot", () => {
  const slots = [slot("a", "1"), slot("b", "2"), slot("c", "3")]

  it("promotes a fallback to primary when dropped at index 0", () => {
    expect(moveSlot(slots, 2, 0)).toEqual([
      slot("c", "3"),
      slot("a", "1"),
      slot("b", "2"),
    ])
  })

  it("demotes the primary when dropped further down", () => {
    expect(moveSlot(slots, 0, 1)).toEqual([
      slot("b", "2"),
      slot("a", "1"),
      slot("c", "3"),
    ])
  })

  it("is a no-op for out-of-range or identical indexes", () => {
    expect(moveSlot(slots, 1, 1)).toBe(slots)
    expect(moveSlot(slots, -1, 0)).toBe(slots)
    expect(moveSlot(slots, 0, 9)).toBe(slots)
  })
})

describe("appendSlot / replaceSlot", () => {
  it("rejects a duplicate model in the same lane", () => {
    const slots = [slot("openai", "gpt-4o")]
    expect(appendSlot(slots, slot("OpenAI", "GPT-4o"))).toBe(slots)
  })

  it("stops at the maximum lane size", () => {
    // Derivado da constante: o fixture fixo em 3 quebrava a cada mudança de limite.
    const full = Array.from({ length: MAX_SLOTS_PER_TIER }, (_, index) =>
      slot(`p${index}`, `m${index}`),
    )
    expect(appendSlot(full, slot("extra", "model"))).toBe(full)
    expect(appendSlot(full.slice(0, -1), slot("extra", "model"))).toHaveLength(
      MAX_SLOTS_PER_TIER,
    )
  })

  it("replaces in place but refuses to create a duplicate", () => {
    const slots = [slot("a", "1"), slot("b", "2")]
    expect(replaceSlot(slots, 1, slot("c", "3"))).toEqual([
      slot("a", "1"),
      slot("c", "3"),
    ])
    expect(replaceSlot(slots, 1, slot("a", "1"))).toBe(slots)
  })
})

describe("cleanModelName", () => {
  it("drops the provider suffix that providers append to the model name", () => {
    expect(cleanModelName("zai-glm-4.7 (Cerebras)", "Cerebras")).toBe(
      "zai-glm-4.7",
    )
  })

  it("leaves names alone when the suffix is a different provider", () => {
    expect(cleanModelName("zai-glm-4.7 (Cerebras)", "Groq")).toBe(
      "zai-glm-4.7 (Cerebras)",
    )
  })

  it("never returns an empty label", () => {
    expect(cleanModelName("(Cerebras)", "Cerebras")).toBe("(Cerebras)")
  })
})

describe("formatPricePer1M / costBand", () => {
  it("returns null when no price is known", () => {
    expect(formatPricePer1M(undefined)).toBeNull()
    expect(
      formatPricePer1M(model({ inputPer1M: null, outputPer1M: null })),
    ).toBeNull()
  })

  it("formats both sides of the price", () => {
    expect(formatPricePer1M(model())).toBe("$2.50 entrada · $10.00 saída / 1M")
    expect(formatPricePer1M(model({ inputPer1M: 0.15 }))).toBe(
      "$0.150 entrada · $10.00 saída / 1M",
    )
  })

  it("bands models against the most expensive one in the catalog", () => {
    expect(costBand(model({ outputPer1M: 0 }), 60)).toBe("free")
    expect(costBand(model({ outputPer1M: 0.6 }), 60)).toBe("low")
    expect(costBand(model({ outputPer1M: 10 }), 60)).toBe("mid")
    expect(costBand(model({ outputPer1M: 60 }), 60)).toBe("high")
    expect(costBand(model({ outputPer1M: null }), 60)).toBe("unknown")
  })
})

describe("healthBadge", () => {
  const withHealth = (health: RoutingModelOption["health"]) =>
    ({ ...model(), health }) as RoutingModelOption

  it("não rotula modelo sem histórico suficiente", () => {
    // Um modelo novo não pode parecer ruim só por falta de dados.
    expect(healthBadge(undefined)).toBeNull()
    expect(healthBadge(withHealth(null))).toBeNull()
    expect(
      healthBadge(withHealth({ total: 4, errorRate: 1, avgDurationMs: 900 })),
    ).toBeNull()
  })

  it("classifica o tom pela taxa de erro observada", () => {
    expect(
      healthBadge(withHealth({ total: 50, errorRate: 0, avgDurationMs: 900 }))
        ?.tone,
    ).toBe("good")
    expect(
      healthBadge(withHealth({ total: 50, errorRate: 0.1, avgDurationMs: 900 }))
        ?.tone,
    ).toBe("warn")
    expect(
      healthBadge(withHealth({ total: 50, errorRate: 0.7, avgDurationMs: 900 }))
        ?.tone,
    ).toBe("bad")
  })

  it("mostra sucesso e latência no title", () => {
    const badge = healthBadge(
      withHealth({ total: 40, errorRate: 0.25, avgDurationMs: 1500 }),
    )
    expect(badge?.label).toBe("75% ok")
    expect(badge?.title).toBe("75% de sucesso em 40 requisições · 1.5s média")
  })
})
