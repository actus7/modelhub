import { DEFAULT_MODELS_CACHE_TTL_MS, getCachedModels } from "../lib/model-cache";
import { createOpenAiCompatibleProvider } from "../lib/openai-compatible";
import type { ProviderModel } from "../lib/provider-core";
import { PROVIDERS } from "./definitions";

type ProviderEntry = {
  handler: (req: Request) => Response | Promise<Response>;
  models: readonly ProviderModel[];
  fetchModels: (credentials?: Record<string, string>) => Promise<ProviderModel[]>;
};

export const providerRegistry: Record<string, ProviderEntry> = Object.fromEntries(
  PROVIDERS.map((provider) => [
    provider.id,
    { ...createOpenAiCompatibleProvider(provider), models: provider.models },
  ]),
);

export type GetProviderModelsOptions = {
  credentials?: Record<string, string>;
  cacheKeySuffix?: string;
  staleWhileRevalidate?: boolean;
};

/** Modelos do provedor via `GET /models` com cache; cai na lista-semente se falhar. */
export async function getProviderModels(
  providerId: string,
  options: GetProviderModelsOptions = {},
): Promise<readonly ProviderModel[]> {
  const entry = providerRegistry[providerId];
  if (!entry) return [];

  return getCachedModels(
    providerId,
    () => entry.fetchModels(options.credentials),
    entry.models,
    DEFAULT_MODELS_CACHE_TTL_MS,
    { cacheKeySuffix: options.cacheKeySuffix, staleWhileRevalidate: options.staleWhileRevalidate },
  );
}
