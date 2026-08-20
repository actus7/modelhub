"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react"

import { useAppState } from "@/components/app-state-provider"
import { ProviderAvatar } from "@/components/dashboard/routing/provider-avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { UiProvider } from "@/lib/contracts"
import {
  providerAuthMode,
  providerHasRequiredCredentials,
} from "@/lib/provider-credentials"
import { buildProviderGroups, providerConnectionLabel } from "./provider-ui"

function ProviderStatus({ provider }: { provider: UiProvider }) {
  const { credentials } = useAppState()
  const ready = providerHasRequiredCredentials(provider, credentials)

  return (
    <Badge variant={ready ? "secondary" : "outline"}>
      {ready ? <CheckCircle2Icon data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
      {providerConnectionLabel(provider, credentials)}
    </Badge>
  )
}

function ProviderCard({ provider }: { provider: UiProvider }) {
  const authMode = providerAuthMode(provider)
  const authLabel = authMode === "api-key"
    ? "Chave de API"
    : authMode === "browser-session"
      ? "Sessão do navegador"
      : "Sem autenticação"

  return (
    <Link
      aria-label={`Configurar ${provider.label}`}
      href={`/dashboard/credentials/${encodeURIComponent(provider.id)}`}
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        size="sm"
        className="h-full transition-colors hover:bg-muted/40"
      >
        <CardHeader className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <ProviderAvatar
            className="rounded-xl"
            label={provider.label}
            providerId={provider.id}
            size={42}
          />
          <div className="min-w-0">
            <CardTitle className="truncate">{provider.label}</CardTitle>
            <CardDescription className="truncate">{authLabel}</CardDescription>
          </div>
          <ArrowUpRightIcon className="size-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <ProviderStatus provider={provider} />
          <span className="text-xs text-muted-foreground">
            {provider.hasModels ? "Modelos disponíveis" : "Serviço auxiliar"}
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}

function ProviderCatalogSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <Skeleton className="h-28 rounded-xl" key={index} />
        ))}
      </div>
    </div>
  )
}

export function ProviderCatalog() {
  const { authReady, credentials, providers } = useAppState()
  const [query, setQuery] = useState("")
  const groups = useMemo(
    () => buildProviderGroups(providers, credentials, query),
    [credentials, providers, query],
  )
  const configuredCount = useMemo(
    () => providers.filter((provider) => providerHasRequiredCredentials(provider, credentials)).length,
    [credentials, providers],
  )
  const visibleCount = groups.reduce((total, group) => total + group.providers.length, 0)

  if (!authReady) return <ProviderCatalogSkeleton />

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <NetworkIcon className="size-5" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">Provedores de IA</h1>
              <Badge variant="outline">{configuredCount} prontos</Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Conecte APIs oficiais, rotas gratuitas e sessões do navegador ao roteador unificado do ModelHub.
            </p>
          </div>
        </div>

        <label className="relative block w-full lg:max-w-sm">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Buscar provedores</span>
          <Input
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, tipo ou integração..."
            type="search"
            value={query}
          />
        </label>
      </div>

      {groups.length === 0 ? (
        <Empty className="border-border/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum provedor encontrado</EmptyTitle>
            <EmptyDescription>Ajuste a busca para ver outras integrações disponíveis.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((group) => {
          const GroupIcon = group.id === "ready"
            ? SparklesIcon
            : group.id === "browser-session"
              ? MonitorSmartphoneIcon
              : KeyRoundIcon
          return (
            <section className="flex flex-col gap-3" key={group.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <GroupIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <h2 className="font-heading text-base font-semibold">{group.title}</h2>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>
                </div>
                <Badge variant="outline">{group.providers.length}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.providers.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            </section>
          )
        })
      )}

      {visibleCount > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          {visibleCount} {visibleCount === 1 ? "provedor exibido" : "provedores exibidos"}
        </p>
      ) : null}
    </div>
  )
}
