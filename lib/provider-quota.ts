import type {
  ProviderQuotaAccount,
  ProviderQuotaProfile,
} from "@/lib/contracts"

export type QuotaProfileRow = {
  providerId: string
  label: string | null
  isEnabled: boolean
  windowHours: number
  requestLimit: number | null
  tokenLimit: number | null
  costLimitUsd: number | null
  updatedAt: Date
}

export type QuotaCredentialRow = {
  providerId: string
  updatedAt: Date
}

export type QuotaUsageRow = {
  providerId: string
  modelId: string | null
  statusCode: number
  requests: number
  tokens: number
  costUsd: number
  oldestAt: Date | null
  lastAt: Date | null
  windowHours: number
}

const STATUS_ORDER: Record<ProviderQuotaAccount["status"], number> = {
  exhausted: 0,
  warning: 1,
  available: 2,
  monitoring: 3,
  disabled: 4,
}

function defaultProfile(providerId: string): ProviderQuotaProfile {
  return {
    providerId,
    label: null,
    isEnabled: true,
    windowHours: 24,
    requestLimit: null,
    tokenLimit: null,
    costLimitUsd: null,
    updatedAt: null,
  }
}

function percentOf(value: number, limit: number | null) {
  if (limit == null || limit <= 0) return null
  return (value / limit) * 100
}

export function buildProviderQuotaAccounts(input: {
  credentials: QuotaCredentialRow[]
  logs: QuotaUsageRow[]
  profiles: QuotaProfileRow[]
}): ProviderQuotaAccount[] {
  const profileByProvider = new Map(input.profiles.map((profile) => [profile.providerId, profile]))
  const providerIds = new Set<string>()

  input.credentials.forEach((credential) => providerIds.add(credential.providerId))
  input.logs.forEach((log) => providerIds.add(log.providerId))
  input.profiles.forEach((profile) => providerIds.add(profile.providerId))

  return Array.from(providerIds, (providerId): ProviderQuotaAccount => {
    const storedProfile = profileByProvider.get(providerId)
    const profile: ProviderQuotaProfile = storedProfile
      ? {
          providerId,
          label: storedProfile.label,
          isEnabled: storedProfile.isEnabled,
          windowHours: storedProfile.windowHours,
          requestLimit: storedProfile.requestLimit,
          tokenLimit: storedProfile.tokenLimit,
          costLimitUsd: storedProfile.costLimitUsd,
          updatedAt: storedProfile.updatedAt.toISOString(),
        }
      : defaultProfile(providerId)

    const logs = input.logs.filter(
      (log) => log.providerId === providerId && log.windowHours === profile.windowHours,
    )
    const credentials = input.credentials.filter((credential) => credential.providerId === providerId)
    const requests = logs.reduce((total, log) => total + log.requests, 0)
    const tokens = logs.reduce((total, log) => total + log.tokens, 0)
    const costUsd = logs.reduce((total, log) => total + log.costUsd, 0)
    const errors = logs.reduce(
      (total, log) => total + (log.statusCode >= 400 ? log.requests : 0),
      0,
    )
    const modelMap = new Map<string, ProviderQuotaAccount["models"][number]>()

    for (const log of logs) {
      const modelId = log.modelId?.trim() || "Modelo não informado"
      const current = modelMap.get(modelId) ?? {
        modelId,
        requests: 0,
        tokens: 0,
        costUsd: 0,
        errors: 0,
      }
      current.requests += log.requests
      current.tokens += log.tokens
      current.costUsd += log.costUsd
      current.errors += log.statusCode >= 400 ? log.requests : 0
      modelMap.set(modelId, current)
    }

    const percentages = [
      percentOf(requests, profile.requestLimit),
      percentOf(tokens, profile.tokenLimit),
      percentOf(costUsd, profile.costLimitUsd),
    ].filter((value): value is number => value != null)
    const rawPercentage = percentages.length > 0 ? Math.max(...percentages) : null
    const percentage = rawPercentage == null ? null : Math.min(100, Math.round(rawPercentage))
    const status: ProviderQuotaAccount["status"] = !profile.isEnabled
      ? "disabled"
      : rawPercentage == null
        ? "monitoring"
        : rawPercentage >= 100
          ? "exhausted"
          : rawPercentage >= 80
            ? "warning"
            : "available"
    const oldestLog = logs.reduce<Date | null>(
      (oldest, log) => (!log.oldestAt || (oldest && oldest <= log.oldestAt) ? oldest : log.oldestAt),
      null,
    )
    const lastLog = logs.reduce<Date | null>(
      (latest, log) => (!log.lastAt || (latest && latest >= log.lastAt) ? latest : log.lastAt),
      null,
    )

    return {
      providerId,
      connectedAt: credentials.length > 0
        ? new Date(Math.max(...credentials.map((credential) => credential.updatedAt.getTime()))).toISOString()
        : null,
      lastActivityAt: lastLog?.toISOString() ?? null,
      resetAt: oldestLog
        ? new Date(oldestLog.getTime() + profile.windowHours * 60 * 60 * 1000).toISOString()
        : null,
      requests,
      tokens,
      costUsd,
      errors,
      percentage,
      status,
      profile,
      models: Array.from(modelMap.values()).sort((a, b) => b.requests - a.requests),
    }
  }).sort((a, b) => {
    const statusDifference = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (statusDifference !== 0) return statusDifference
    return (b.percentage ?? -1) - (a.percentage ?? -1) || a.providerId.localeCompare(b.providerId)
  })
}
