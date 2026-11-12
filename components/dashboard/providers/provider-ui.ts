import type { ProviderCredentialSummary, UiProvider } from "@/lib/contracts"
import { providerHasRequiredCredentials } from "@/lib/provider-credentials"

export type ProviderGroupId = "connected" | "available"

export type ProviderGroup = {
  description: string
  id: ProviderGroupId
  providers: UiProvider[]
  title: string
}

const GROUP_COPY: Record<ProviderGroupId, Omit<ProviderGroup, "providers">> = {
  connected: {
    description: "Provedores com chave de API salva e prontos para uso.",
    id: "connected",
    title: "Conectados",
  },
  available: {
    description: "Conecte sua própria chave de API para usar estes provedores.",
    id: "available",
    title: "Disponíveis",
  },
}

export function providerConnectionLabel(
  provider: UiProvider,
  credentials: ProviderCredentialSummary[],
): string {
  return providerHasRequiredCredentials(provider, credentials) ? "Conectado" : "Não conectado"
}

export function buildProviderGroups(
  providers: UiProvider[],
  credentials: ProviderCredentialSummary[],
  query: string,
): ProviderGroup[] {
  const needle = query.trim().toLocaleLowerCase("pt-BR")
  const filtered = providers.filter(
    (provider) =>
      !needle ||
      [provider.label, provider.id].some((value) => value.toLocaleLowerCase("pt-BR").includes(needle)),
  )
  const byLabel = (left: UiProvider, right: UiProvider) => left.label.localeCompare(right.label, "pt-BR")
  const connected = filtered.filter((provider) => providerHasRequiredCredentials(provider, credentials))
  const available = filtered.filter((provider) => !providerHasRequiredCredentials(provider, credentials))

  return [
    { ...GROUP_COPY.connected, providers: connected.sort(byLabel) },
    { ...GROUP_COPY.available, providers: available.sort(byLabel) },
  ].filter((group) => group.providers.length > 0)
}
