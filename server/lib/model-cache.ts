import type { ProviderModel } from './provider-core'

type CacheEntry = {
  models: ProviderModel[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const inflightRefreshes = new Map<string, Promise<void>>()

/** Default TTL: 1 hour */
export const DEFAULT_MODELS_CACHE_TTL_MS = 60 * 60 * 1000

export type GetCachedModelsOptions = {
  /**
   * Distinct lists per user/credentials. When omitted, key is only `providerId`
   * (e.g. aggregated GET /v1/models with server env).
   */
  cacheKeySuffix?: string
  /**
   * When true (default), expired entries are returned once while a refresh runs in the background.
   * When false, expired entries trigger an awaited refresh before returning.
   */
  staleWhileRevalidate?: boolean
}

function fullCacheKey(providerId: string, suffix: string | undefined): string {
  const s = suffix?.trim()
  return s ? `${providerId}:${s}` : providerId
}

function dedupeModels(models: readonly ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>()
  const out: ProviderModel[] = []
  for (const model of models) {
    const id = model.id.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    out.push({ ...model, id })
  }
  return out
}

/**
 * Get cached models for a provider, or fetch them dynamically.
 * Falls back to `fallbackModels` if the upstream fetch fails.
 */
export async function getCachedModels(
  providerId: string,
  fetchFn: () => Promise<ProviderModel[]>,
  fallbackModels: readonly ProviderModel[],
  ttlMs: number = DEFAULT_MODELS_CACHE_TTL_MS,
  options: GetCachedModelsOptions = {},
): Promise<ProviderModel[]> {
  const cacheKey = fullCacheKey(providerId, options.cacheKeySuffix)
  const staleWhileRevalidate = options.staleWhileRevalidate ?? true
  const entry = cache.get(cacheKey)
  const now = Date.now()

  // Return cached if still valid
  if (entry && now - entry.fetchedAt < ttlMs) {
    return dedupeModels(entry.models)
  }

  // Fetch in background if cache is stale but exists (serve stale while refreshing)
  if (entry && staleWhileRevalidate) {
    refreshInBackground(cacheKey, fetchFn)
    return dedupeModels(entry.models)
  }

  // No cache at all — or stale with sync revalidate — fetch synchronously
  try {
    const models = await fetchFn()
    if (models.length > 0) {
      const deduped = dedupeModels(models)
      cache.set(cacheKey, { models: deduped, fetchedAt: now })
      return deduped
    }
  } catch (error) {
    console.warn(`[ModelCache] Failed to fetch models for ${cacheKey}:`, error instanceof Error ? error.message : error)
  }

  // Return fallback
  return dedupeModels(fallbackModels)
}

function refreshInBackground(
  cacheKey: string,
  fetchFn: () => Promise<ProviderModel[]>,
) {
  if (inflightRefreshes.has(cacheKey)) {
    return
  }

  const task = fetchFn()
    .then((models) => {
      if (models.length > 0) {
        const deduped = dedupeModels(models)
        cache.set(cacheKey, { models: deduped, fetchedAt: Date.now() })
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[ModelCache] Refreshed ${cacheKey}: ${deduped.length} models`)
        }
      }
    })
    .catch((error) => {
      console.warn(`[ModelCache] Background refresh failed for ${cacheKey}:`, error instanceof Error ? error.message : error)
    })
    .finally(() => {
      inflightRefreshes.delete(cacheKey)
    })

  inflightRefreshes.set(cacheKey, task)
}
