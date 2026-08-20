import { describe, expect, it } from "vitest"

import type { ProviderCredentialSummary, UiProvider } from "@/lib/contracts"
import {
  buildProviderGroups,
  providerConnectionLabel,
  providerGroupId,
} from "./provider-ui"

const provider = (
  id: string,
  authMode: "api-key" | "browser-session" | "none",
): UiProvider => ({
  base: `/${id}`,
  hasModels: true,
  id,
  label: id === "moonshot" ? "Moonshot (Kimi)" : id,
  requiredKeys: authMode === "api-key"
    ? [{ envName: `${id.toUpperCase()}_KEY`, label: "API key", placeholder: "sk-..." }]
    : [],
  runtime: {
    authMode,
    externalApi: authMode !== "browser-session",
    kind: authMode === "browser-session" ? "client" : "server",
    openAiCompatible: authMode !== "browser-session",
    transport: authMode === "browser-session" ? "browser-sdk" : "openai-compatible",
  },
})

describe("provider UI grouping", () => {
  it("groups providers by their real authentication mode", () => {
    expect(providerGroupId(provider("duckai", "none"))).toBe("ready")
    expect(providerGroupId(provider("puter", "browser-session"))).toBe("browser-session")
    expect(providerGroupId(provider("moonshot", "api-key"))).toBe("api-key")
  })

  it("filters by label and keeps configured API providers first", () => {
    const providers = [
      provider("openai", "api-key"),
      provider("moonshot", "api-key"),
      provider("duckai", "none"),
    ]
    const credentials: ProviderCredentialSummary[] = [{
      credentialKey: "MOONSHOT_KEY",
      id: "credential-1",
      providerId: "moonshot",
      updatedAt: new Date().toISOString(),
    }]

    const apiGroup = buildProviderGroups(providers, credentials, "")[1]
    expect(apiGroup?.providers.map((item) => item.id)).toEqual(["moonshot", "openai"])
    expect(buildProviderGroups(providers, credentials, "kimi")[0]?.providers[0]?.id).toBe("moonshot")
  })

  it("describes connection readiness without exposing secret values", () => {
    const moonshot = provider("moonshot", "api-key")
    expect(providerConnectionLabel(moonshot, [])).toBe("Não conectado")
    expect(providerConnectionLabel(moonshot, [{
      credentialKey: "MOONSHOT_KEY",
      id: "credential-1",
      providerId: "moonshot",
      updatedAt: new Date().toISOString(),
    }])).toBe("Conectado")
  })
})

