import { describe, expect, it } from "vitest"

import { buildProviderQuotaAccounts } from "./provider-quota"

const NOW = new Date("2026-08-20T12:00:00.000Z")

describe("buildProviderQuotaAccounts", () => {
  it("combina limites configurados com uso real dentro da janela", () => {
    const [account] = buildProviderQuotaAccounts({
      credentials: [{ providerId: "groq", updatedAt: NOW }],
      profiles: [{
        providerId: "groq",
        label: "Produção",
        isEnabled: true,
        windowHours: 24,
        requestLimit: 10,
        tokenLimit: 1_000,
        costLimitUsd: null,
        updatedAt: NOW,
      }],
      logs: [
        {
          providerId: "groq",
          modelId: "llama",
          statusCode: 200,
          requests: 1,
          tokens: 400,
          costUsd: 0.01,
          oldestAt: new Date("2026-08-20T10:00:00.000Z"),
          lastAt: new Date("2026-08-20T10:00:00.000Z"),
          windowHours: 24,
        },
        {
          providerId: "groq",
          modelId: "llama",
          statusCode: 429,
          requests: 1,
          tokens: 500,
          costUsd: 0,
          oldestAt: new Date("2026-08-20T11:00:00.000Z"),
          lastAt: new Date("2026-08-20T11:00:00.000Z"),
          windowHours: 24,
        },
      ],
    })

    expect(account).toMatchObject({
      providerId: "groq",
      requests: 2,
      tokens: 900,
      errors: 1,
      percentage: 90,
      status: "warning",
    })
    expect(account.models[0]).toMatchObject({ modelId: "llama", requests: 2 })
    expect(account.resetAt).toBe("2026-08-21T10:00:00.000Z")
  })

  it("não inventa percentual quando nenhum limite foi informado", () => {
    const [account] = buildProviderQuotaAccounts({
      credentials: [{ providerId: "openrouter", updatedAt: NOW }],
      profiles: [],
      logs: [],
    })

    expect(account.percentage).toBeNull()
    expect(account.status).toBe("monitoring")
    expect(account.profile.windowHours).toBe(24)
  })

  it("marca a conta como esgotada quando qualquer limite chega a cem por cento", () => {
    const [account] = buildProviderQuotaAccounts({
      credentials: [],
      profiles: [{
        providerId: "moonshot",
        label: null,
        isEnabled: true,
        windowHours: 1,
        requestLimit: 1,
        tokenLimit: null,
        costLimitUsd: null,
        updatedAt: NOW,
      }],
      logs: [{
        providerId: "moonshot",
        modelId: "kimi",
        statusCode: 200,
        requests: 1,
        tokens: 0,
        costUsd: 0,
        oldestAt: NOW,
        lastAt: NOW,
        windowHours: 1,
      }],
    })

    expect(account.status).toBe("exhausted")
    expect(account.percentage).toBe(100)
  })
})
