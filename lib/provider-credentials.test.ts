import { describe, expect, it } from "vitest";

import {
  providerHasRequiredCredentials,
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
          base: "/example",
          hasModels: true,
          id: "example",
          label: "Example",
          requiredKeys: [
            { envName: "EXAMPLE_TOKEN", label: "Token", placeholder: "..." },
            { envName: "EXAMPLE_ACCOUNT", label: "Account ID", placeholder: "..." },
          ],
        },
        [
          {
            credentialKey: "EXAMPLE_TOKEN",
            id: "1",
            providerId: "example",
            updatedAt: new Date().toISOString(),
          },
          {
            credentialKey: "EXAMPLE_ACCOUNT",
            id: "2",
            providerId: "example",
            updatedAt: new Date().toISOString(),
          },
        ],
      ),
    ).toBe(true);
  });

  it("sorts providers with configured credentials first", () => {
    const providers = [
      {
        base: "/openrouter",
        hasModels: true,
        id: "openrouter",
        label: "OpenRouter",
        requiredKeys: [
          { envName: "OPENROUTER_API_KEY", label: "API Key", placeholder: "sk-or-..." },
        ],
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
