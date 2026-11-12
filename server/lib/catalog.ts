import type { UiProvider } from "@/lib/contracts";

import { PROVIDERS } from "../providers/definitions";
import { parseCsvSet } from "./env-utils";

export const PROVIDER_CATALOG: readonly UiProvider[] = PROVIDERS.map((provider) => ({
  id: provider.id,
  label: provider.label,
  base: `/${provider.id}`,
  hasModels: true,
  requiredEnv: provider.apiKeyEnv,
  requiredKeys: [
    { envName: provider.apiKeyEnv, label: "API Key", placeholder: provider.keyPlaceholder ?? "Cole sua chave" },
  ],
  signupUrl: provider.signupUrl,
  signupLabel: provider.signupUrl ? `Obter chave em ${provider.label}` : undefined,
}));

export function isProviderEnabled(providerId: string): boolean {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const enabledProviders = parseCsvSet(process.env.ENABLED_PROVIDERS);
  if (enabledProviders.size > 0) {
    return enabledProviders.has(normalizedProviderId);
  }

  const disabledProviders = parseCsvSet(process.env.DISABLED_PROVIDERS);
  return !disabledProviders.has(normalizedProviderId);
}

export function getAvailableProviders(): UiProvider[] {
  return PROVIDER_CATALOG.filter((provider) => isProviderEnabled(provider.id));
}
