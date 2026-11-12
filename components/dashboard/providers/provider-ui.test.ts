import { describe, expect, it } from "vitest";

import type { ProviderCredentialSummary, UiProvider } from "@/lib/contracts";
import { buildProviderGroups, providerConnectionLabel } from "./provider-ui";

const provider = (id: string, label = id): UiProvider => ({
  base: `/${id}`,
  hasModels: true,
  id,
  label,
  requiredKeys: [{ envName: `${id.toUpperCase()}_KEY`, label: "API key", placeholder: "sk-..." }],
});

const moonshotCredential: ProviderCredentialSummary = {
  credentialKey: "MOONSHOT_KEY",
  id: "credential-1",
  providerId: "moonshot",
  updatedAt: new Date().toISOString(),
};

describe("provider UI grouping", () => {
  it("splits providers into connected and available groups", () => {
    const groups = buildProviderGroups(
      [provider("openai", "OpenAI"), provider("moonshot", "Moonshot (Kimi)")],
      [moonshotCredential],
      "",
    );
    expect(groups.map((group) => [group.id, group.providers.map((item) => item.id)])).toEqual([
      ["connected", ["moonshot"]],
      ["available", ["openai"]],
    ]);
  });

  it("filters by label", () => {
    const groups = buildProviderGroups(
      [provider("openai", "OpenAI"), provider("moonshot", "Moonshot (Kimi)")],
      [],
      "kimi",
    );
    expect(groups.flatMap((group) => group.providers.map((item) => item.id))).toEqual(["moonshot"]);
  });

  it("describes connection readiness without exposing secret values", () => {
    const moonshot = provider("moonshot");
    expect(providerConnectionLabel(moonshot, [])).toBe("Não conectado");
    expect(providerConnectionLabel(moonshot, [moonshotCredential])).toBe("Conectado");
  });
});
