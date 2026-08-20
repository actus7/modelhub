import type { ProviderCredentialSummary, UiProvider } from "@/lib/contracts"
import {
  providerAuthMode,
  providerHasRequiredCredentials,
} from "@/lib/provider-credentials"

export type ProviderGroupId = "ready" | "browser-session" | "api-key"

export type ProviderGroup = {
  description: string
  id: ProviderGroupId
  providers: UiProvider[]
  title: string
}

const GROUP_COPY: Record<ProviderGroupId, Omit<ProviderGroup, "providers">> = {
  ready: {
    description: "Rotas gratuitas, locais ou gerenciadas pelo ModelHub, sem chave adicional.",
    id: "ready",
    title: "Prontos para usar",
  },
  "browser-session": {
    description: "Providers que autenticam diretamente na sessão do navegador.",
    id: "browser-session",
    title: "Sessão no navegador",
  },
  "api-key": {
    description: "Conecte sua própria chave para usar modelos oficiais e planos de assinatura.",
    id: "api-key",
    title: "Providers com chave de API",
  },
}

export function providerGroupId(provider: UiProvider): ProviderGroupId {
  const authMode = providerAuthMode(provider)
  if (authMode === "api-key") return "api-key"
  if (authMode === "browser-session") return "browser-session"
  return "ready"
}

export function providerConnectionLabel(
  provider: UiProvider,
  credentials: ProviderCredentialSummary[],
): string {
  const authMode = providerAuthMode(provider)
  if (authMode === "none") return "Pronto para usar"
  if (authMode === "browser-session") return "Sessão do navegador"

  const required = provider.requiredKeys?.length ?? 0
  const saved = credentials.filter(
    (credential) => credential.providerId === provider.id,
  ).length
  if (providerHasRequiredCredentials(provider, credentials)) {
    return required > 1 ? `${saved}/${required} credenciais` : "Conectado"
  }
  return required > 1 ? `${saved}/${required} credenciais` : "Não conectado"
}

export function buildProviderGroups(
  providers: UiProvider[],
  credentials: ProviderCredentialSummary[],
  query: string,
): ProviderGroup[] {
  const needle = query.trim().toLocaleLowerCase("pt-BR")
  const filtered = providers.filter((provider) => {
    if (!needle) return true
    return [provider.label, provider.id, provider.category, provider.runtime?.transport]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(needle))
  })

  const buckets = new Map<ProviderGroupId, UiProvider[]>([
    ["ready", []],
    ["browser-session", []],
    ["api-key", []],
  ])

  for (const provider of filtered) {
    buckets.get(providerGroupId(provider))?.push(provider)
  }

  return (["ready", "browser-session", "api-key"] as const)
    .map((id) => ({
      ...GROUP_COPY[id],
      providers: (buckets.get(id) ?? []).sort((left, right) => {
        const readiness = Number(providerHasRequiredCredentials(right, credentials))
          - Number(providerHasRequiredCredentials(left, credentials))
        return readiness || left.label.localeCompare(right.label, "pt-BR")
      }),
    }))
    .filter((group) => group.providers.length > 0)
}

