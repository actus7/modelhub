import { describe, expect, it } from "vitest";

import {
  providerAuthMode,
  providerHasRequiredCredentials,
  providerSupportsExternalApi,
  providerUsesBrowserSession,
  sortProvidersByConfiguredCredentials,
} from "./provider-credentials";

describe("providerHasRequiredCredentials", () => {
  it("returns true for providers without required keys", () => {
    expect(
      providerHasRequiredCredentials(
        {
          base: "/gateway",
          hasModels: true,
          id: "gateway",
          label: "Gateway",
        },
        [],
      ),
    ).toBe(true);
  });

  it("returns false when a required credential is missing", () => {
    expect(
      providerHasRequiredCredentials(
        {
          base: "/openrouter",
          hasModels: true,
          id: "openrouter",
          label: "OpenRouter",
          requiredKeys: [
            {
              envName: "OPENROUTER_API_KEY",
              label: "API Key",
              placeholder: "sk-or-...",
            },
          ],
        },
        [],
      ),
    ).toBe(false);
  });

  it("returns true when all required credentials are present", () => {
    expect(
      providerHasRequiredCredentials(
        {
          base: "/cloudflareworkersai",
          hasModels: true,
          id: "cloudflareworkersai",
          label: "Cloudflare Workers AI",
          requiredKeys: [
            { envName: "CLOUDFLARE_API_TOKEN", label: "Token", placeholder: "..." },
          ],
        },
        [
          {
            credentialKey: "CLOUDFLARE_API_TOKEN",
            id: "1",
            providerId: "cloudflareworkersai",
            updatedAt: new Date().toISOString(),
          },
        ],
      ),
    ).toBe(true);
  });

  it("uses explicit provider runtime metadata before requiredKeys heuristics", () => {
    const browserProvider = {
      base: "/puter",
      hasModels: true,
      id: "puter",
      label: "Puter",
      runtime: {
        authMode: "browser-session" as const,
        externalApi: false,
        kind: "client" as const,
        openAiCompatible: false,
        transport: "browser-sdk" as const,
      },
    };

    expect(providerAuthMode(browserProvider)).toBe("browser-session");
    expect(providerHasRequiredCredentials(browserProvider, [])).toBe(true);
    expect(providerUsesBrowserSession(browserProvider)).toBe(true);
    expect(providerSupportsExternalApi(browserProvider)).toBe(false);
  });

  it("sorts providers with configured credentials first", () => {
    const providers = [
      {
        base: "/openrouter",
        hasModels: true,
        id: "openrouter",
        label: "OpenRouter",
        requiredKeys: [{ envName: "OPENROUTER_API_KEY", label: "API Key", placeholder: "sk-or-..." }],
      },
      {
        base: "/groq",
        hasModels: true,
        id: "groq",
        label: "Groq",
        requiredKeys: [{ envName: "GROQ_API_KEY", label: "API Key", placeholder: "gsk_..." }],
      },
      {
        base: "/mistral",
        hasModels: true,
        id: "mistral",
        label: "Mistral",
        requiredKeys: [{ envName: "MISTRAL_API_KEY", label: "API Key", placeholder: "..." }],
      },
    ];

    expect(
      sortProvidersByConfiguredCredentials(providers, [
        {
          credentialKey: "GROQ_API_KEY",
          id: "1",
          providerId: "groq",
          updatedAt: new Date().toISOString(),
        },
      ]).map((provider) => provider.id),
    ).toEqual(["groq", "openrouter", "mistral"]);
  });
});
