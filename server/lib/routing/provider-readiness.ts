import { createHash } from 'node:crypto'

import type { UiProvider } from '@/lib/contracts'

import { isProviderEnabled, PROVIDER_CATALOG } from '../catalog'
import { decryptCredential } from '../crypto'
import { prisma } from '../db'
import { getProviderModels, isProviderAvailableViaExternalApi } from '../../providers/registry'

export type RoutingProviderSource = {
  providerId: string
  credentials: Record<string, string>
  cacheKeySuffix: string
}

export type RoutingProviderModelReadiness = {
  providerIds: Set<string>
  modelKeys: Set<string>
}

function providerCredentialKeys(provider: UiProvider): string[] {
  return provider.requiredKeys?.map((field) => field.envName) ?? []
}

function providerAuthMode(provider: UiProvider): string {
  if (provider.runtime?.authMode) return provider.runtime.authMode
  return providerCredentialKeys(provider).length > 0 ? 'api-key' : 'none'
}

function hasConfiguredValue(credentials: Record<string, string>, key: string): boolean {
  const fromCredentials = credentials[key]
  if (typeof fromCredentials === 'string' && fromCredentials.trim().length > 0) return true

  const fromEnv = process.env[key]
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0
}

function isProviderReadyForRouting(
  provider: UiProvider,
  credentials: Record<string, string> = {},
): boolean {
  if (!provider.hasModels) return false
  if (!isProviderEnabled(provider.id)) return false
  if (!isProviderAvailableViaExternalApi(provider.id)) return false

  const authMode = providerAuthMode(provider)
  if (authMode === 'none') return true
  if (authMode !== 'api-key') return false

  const requiredKeys = providerCredentialKeys(provider)
  if (requiredKeys.length === 0) return true
  return requiredKeys.every((key) => hasConfiguredValue(credentials, key))
}

function buildCacheKeySuffix(userId: string, credentials: Record<string, string>): string {
  const keys = Object.keys(credentials).sort()
  if (keys.length === 0) return `${userId}:env`

  const payload = keys.map((key) => `${key}=${credentials[key] ?? ''}`).join('\n')
  const hash = createHash('sha256').update(payload).digest('base64url').slice(0, 32)
  return `${userId}:${hash}`
}

async function getUserProviderCredentialsByProvider(userId: string): Promise<Record<string, Record<string, string>>> {
  const rows = await prisma.providerCredential.findMany({
    where: { userId },
    select: {
      credentialKey: true,
      credentialValue: true,
      providerId: true,
    },
  })

  const credentialsByProvider: Record<string, Record<string, string>> = {}
  for (const row of rows) {
    try {
      credentialsByProvider[row.providerId] ??= {}
      credentialsByProvider[row.providerId]![row.credentialKey] = decryptCredential(row.credentialValue)
    } catch (error) {
      console.warn('Ignoring provider credential that cannot be decrypted for routing', {
        credentialKey: row.credentialKey,
        providerId: row.providerId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return credentialsByProvider
}

export async function getConfiguredRoutingProviders(userId: string): Promise<UiProvider[]> {
  const credentialsByProvider = await getUserProviderCredentialsByProvider(userId)
  return PROVIDER_CATALOG.filter((provider) =>
    isProviderReadyForRouting(provider, credentialsByProvider[provider.id] ?? {}),
  )
}

export async function getConfiguredRoutingProviderSources(userId: string): Promise<RoutingProviderSource[]> {
  const credentialsByProvider = await getUserProviderCredentialsByProvider(userId)
  return PROVIDER_CATALOG
    .filter((provider) => isProviderReadyForRouting(provider, credentialsByProvider[provider.id] ?? {}))
    .map((provider) => {
      const credentials = credentialsByProvider[provider.id] ?? {}
      return {
        providerId: provider.id,
        credentials,
        cacheKeySuffix: buildCacheKeySuffix(userId, credentials),
      }
    })
}

export async function getConfiguredRoutingProviderModelReadiness(
  userId: string,
): Promise<RoutingProviderModelReadiness> {
  const sources = await getConfiguredRoutingProviderSources(userId)
  const providerIds = new Set(sources.map((source) => source.providerId))
  const modelKeys = new Set<string>()

  const results = await Promise.allSettled(
    sources.map(async ({ cacheKeySuffix, credentials, providerId }) => {
      const models = await getProviderModels(providerId, { cacheKeySuffix, credentials })
      for (const model of models) {
        modelKeys.add(`${providerId.toLowerCase()}/${model.id.toLowerCase()}`)
      }
    }),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Failed to load provider models for routing readiness', {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  return { providerIds, modelKeys }
}
