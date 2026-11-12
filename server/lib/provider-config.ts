import { createHash } from "node:crypto";

import type { ProviderModel } from "@/lib/contracts";

import { DEFAULT_MODELS_CACHE_TTL_MS, getCachedModels } from "./model-cache";
import type { ChatMessage } from "./provider-messages";

export type ProviderConfig = {
  providerId: string;
  basePath: string;
  models: ProviderModel[];
  defaultModel: string;
  /** TTL for dynamic model lists (`GET …/api/models`). Default 1h. */
  modelsCacheTtlMs?: number;
  chat: (
    messages: ChatMessage[],
    modelId: string,
    rawBody: Record<string, unknown>,
    credentials: Record<string, string>,
    userId?: string,
  ) => Promise<Response>;
  /** Optional function to test credentials against the upstream provider. */
  testCredentials?: (
    credentials: Record<string, string>,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Optional function to fetch models dynamically from upstream. Results are cached with TTL. */
  fetchModels?: (credentials?: Record<string, string>) => Promise<ProviderModel[]>;
};

function buildProviderModelsCacheKeySuffix(
  userId: string | undefined,
  credentials: Record<string, string>,
): string {
  const uid = userId ?? "anon";
  const keys = Object.keys(credentials).sort();
  if (keys.length === 0) {
    return `${uid}:env`;
  }
  const payload = keys.map((k) => `${k}=${credentials[k] ?? ""}`).join("\n");
  const hash = createHash("sha256").update(payload).digest("base64url").slice(0, 32);
  return `${uid}:${hash}`;
}

export function fetchCachedProviderModels(
  config: ProviderConfig,
  credentials: Record<string, string>,
  userId: string | undefined,
): Promise<ProviderModel[]> {
  return getCachedModels(
    config.providerId,
    () => config.fetchModels?.(credentials) ?? Promise.resolve([]),
    config.models,
    config.modelsCacheTtlMs ?? DEFAULT_MODELS_CACHE_TTL_MS,
    {
      cacheKeySuffix: buildProviderModelsCacheKeySuffix(userId, credentials),
      staleWhileRevalidate: false,
    },
  );
}
