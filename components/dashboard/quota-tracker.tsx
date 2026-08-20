"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  GaugeIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SearchXIcon,
  ShieldQuestionIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useAppState } from "@/components/app-state-provider"
import { ProviderAvatar } from "@/components/dashboard/routing/provider-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type {
  ProviderQuotaAccount,
  ProviderQuotaResponse,
} from "@/lib/contracts"
import { apiJson, apiJsonRequest } from "@/lib/api"

type QuotaStatusFilter = "all" | "available" | "attention" | "disabled"
type QuotaSort = "risk" | "usage" | "provider"

const WINDOW_LABELS: Record<number, string> = {
  1: "1 hora",
  6: "6 horas",
  24: "24 horas",
  168: "7 dias",
  720: "30 dias",
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value)
}

function formatReset(resetAt: string | null, windowHours: number) {
  if (!resetAt) return `Janela móvel de ${WINDOW_LABELS[windowHours] ?? `${windowHours}h`}`
  const milliseconds = new Date(resetAt).getTime() - Date.now()
  if (milliseconds <= 0) return "Renovando agora"
  const minutes = Math.ceil(milliseconds / 60_000)
  if (minutes < 60) return `Próxima liberação em ${minutes} min`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `Próxima liberação em ${hours} h`
  return `Próxima liberação em ${Math.ceil(hours / 24)} dias`
}

function statusCopy(status: ProviderQuotaAccount["status"]) {
  switch (status) {
    case "available":
      return { label: "Disponível", variant: "secondary" as const, icon: CheckCircle2Icon }
    case "warning":
      return { label: "Atenção", variant: "outline" as const, icon: AlertTriangleIcon }
    case "exhausted":
      return { label: "Esgotado", variant: "destructive" as const, icon: AlertTriangleIcon }
    case "disabled":
      return { label: "Pausado", variant: "outline" as const, icon: Clock3Icon }
    default:
      return { label: "Monitorando", variant: "outline" as const, icon: ShieldQuestionIcon }
  }
}

function QuotaMetric({
  label,
  limit,
  value,
  formatter = formatCompact,
}: {
  formatter?: (value: number) => string
  label: string
  limit: number | null
  value: number
}) {
  const percentage = limit == null ? null : Math.min(100, Math.round((value / limit) * 100))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {formatter(value)} / {limit == null ? "limite não informado" : formatter(limit)}
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${percentage ?? 0}%`}
        value={percentage ?? 0}
        className={limit == null ? "opacity-40" : undefined}
      />
      <div className="flex justify-end text-xs text-muted-foreground">
        {percentage == null ? "—" : `${percentage}% utilizado`}
      </div>
    </div>
  )
}

function QuotaSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-96 rounded-xl" key={index} />
        ))}
      </div>
    </div>
  )
}

type EditorState = {
  providerId: string
  label: string
  isEnabled: boolean
  windowHours: string
  requestLimit: string
  tokenLimit: string
  costLimitUsd: string
}

function optionalNumber(value: string) {
  const normalized = value.trim().replace(",", ".")
  return normalized ? Number(normalized) : null
}

export function QuotaTracker() {
  const { providers } = useAppState()
  const [payload, setPayload] = useState<ProviderQuotaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [hideEmpty, setHideEmpty] = useState(false)
  const [providerFilter, setProviderFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<QuotaStatusFilter>("all")
  const [sort, setSort] = useState<QuotaSort>("risk")
  const [editor, setEditor] = useState<EditorState | null>(null)

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  )

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    try {
      setPayload(await apiJson<ProviderQuotaResponse>("/user/quotas"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar quotas.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = window.setInterval(() => void load(true), 60_000)
    return () => window.clearInterval(interval)
  }, [autoRefresh, load])

  const accounts = useMemo(() => {
    const filtered = (payload?.accounts ?? []).filter((account) => {
      if (providerFilter !== "all" && account.providerId !== providerFilter) return false
      if (hideEmpty && account.requests === 0 && account.tokens === 0 && account.costUsd === 0) return false
      if (statusFilter === "available" && !["available", "monitoring"].includes(account.status)) return false
      if (statusFilter === "attention" && !["warning", "exhausted"].includes(account.status)) return false
      if (statusFilter === "disabled" && account.status !== "disabled") return false
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sort === "provider") {
        const aLabel = providerById.get(a.providerId)?.label ?? a.providerId
        const bLabel = providerById.get(b.providerId)?.label ?? b.providerId
        return aLabel.localeCompare(bLabel)
      }
      if (sort === "usage") return b.requests - a.requests || b.tokens - a.tokens
      const order = { exhausted: 0, warning: 1, available: 2, monitoring: 3, disabled: 4 }
      return order[a.status] - order[b.status] || (b.percentage ?? -1) - (a.percentage ?? -1)
    })
  }, [hideEmpty, payload, providerById, providerFilter, sort, statusFilter])

  const totals = useMemo(() => {
    const all = payload?.accounts ?? []
    return {
      active: all.filter((account) => account.status !== "disabled").length,
      attention: all.filter((account) => ["warning", "exhausted"].includes(account.status)).length,
      requests: all.reduce((total, account) => total + account.requests, 0),
      tokens: all.reduce((total, account) => total + account.tokens, 0),
    }
  }, [payload])

  function openEditor(account: ProviderQuotaAccount) {
    setEditor({
      providerId: account.providerId,
      label: account.profile.label ?? "",
      isEnabled: account.profile.isEnabled,
      windowHours: String(account.profile.windowHours),
      requestLimit: account.profile.requestLimit == null ? "" : String(account.profile.requestLimit),
      tokenLimit: account.profile.tokenLimit == null ? "" : String(account.profile.tokenLimit),
      costLimitUsd: account.profile.costLimitUsd == null ? "" : String(account.profile.costLimitUsd),
    })
  }

  async function saveEditor() {
    if (!editor) return
    const requestLimit = optionalNumber(editor.requestLimit)
    const tokenLimit = optionalNumber(editor.tokenLimit)
    const costLimitUsd = optionalNumber(editor.costLimitUsd)
    if ([requestLimit, tokenLimit, costLimitUsd].some((value) => value != null && (!Number.isFinite(value) || value <= 0))) {
      toast.error("Os limites devem ser números maiores que zero.")
      return
    }

    setSaving(true)
    try {
      await apiJsonRequest(`/user/quotas/${encodeURIComponent(editor.providerId)}`, "PATCH", {
        label: editor.label.trim() || null,
        isEnabled: editor.isEnabled,
        windowHours: Number(editor.windowHours),
        requestLimit,
        tokenLimit,
        costLimitUsd,
      })
      setEditor(null)
      await load(true)
      toast.success("Limites de quota atualizados.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar quota.")
    } finally {
      setSaving(false)
    }
  }

  async function updateEnabled(account: ProviderQuotaAccount, isEnabled: boolean) {
    try {
      await apiJsonRequest(`/user/quotas/${encodeURIComponent(account.providerId)}`, "PATCH", { isEnabled })
      await load(true)
      toast.success(isEnabled ? "Monitoramento ativado." : "Monitoramento pausado.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar monitoramento.")
    }
  }

  async function removeLimits() {
    if (!editor) return
    setSaving(true)
    try {
      await apiJsonRequest(`/user/quotas/${encodeURIComponent(editor.providerId)}`, "DELETE")
      setEditor(null)
      await load(true)
      toast.success("Limites personalizados removidos.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover limites.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <QuotaSkeleton />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GaugeIcon className="size-5" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">Quota Tracker</h1>
              <Badge variant="outline">{totals.active} monitorados</Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Acompanhe o consumo observado e compare com os limites reais do plano de cada provedor.
            </p>
          </div>
        </div>
        <Button onClick={() => void load(true)} variant="outline" disabled={refreshing}>
          {refreshing ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <RefreshCwIcon data-icon="inline-start" />}
          {refreshing ? "Atualizando" : "Atualizar quotas"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader><CardDescription>Contas monitoradas</CardDescription><CardTitle className="text-2xl">{totals.active}</CardTitle></CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Precisam de atenção</CardDescription><CardTitle className="text-2xl">{totals.attention}</CardTitle></CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Requests nas janelas</CardDescription><CardTitle className="text-2xl">{formatCompact(totals.requests)}</CardTitle></CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Tokens nas janelas</CardDescription><CardTitle className="text-2xl">{formatCompact(totals.tokens)}</CardTitle></CardHeader>
        </Card>
      </div>

      <Card size="sm">
        <CardContent className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-full md:w-56" aria-label="Filtrar por provedor"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">Todos os provedores</SelectItem>
              {(payload?.accounts ?? []).map((account) => (
                <SelectItem key={account.providerId} value={account.providerId}>
                  {providerById.get(account.providerId)?.label ?? account.providerId}
                </SelectItem>
              ))}
            </SelectGroup></SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as QuotaStatusFilter)}>
            <SelectTrigger className="w-full md:w-48" aria-label="Filtrar por status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="available">Disponíveis</SelectItem>
              <SelectItem value="attention">Atenção ou esgotados</SelectItem>
              <SelectItem value="disabled">Pausados</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as QuotaSort)}>
            <SelectTrigger className="w-full md:w-44" aria-label="Ordenar quotas"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="risk">Maior risco</SelectItem>
              <SelectItem value="usage">Maior uso</SelectItem>
              <SelectItem value="provider">Nome do provedor</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={hideEmpty} onCheckedChange={setHideEmpty} aria-label="Ocultar contas sem uso" />
              Ocultar vazios
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Atualização automática" />
              Atualização automática
            </label>
          </div>
        </CardContent>
      </Card>

      {accounts.length === 0 ? (
        <Empty className="border-border/60">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SearchXIcon /></EmptyMedia>
            <EmptyTitle>Nenhuma quota encontrada</EmptyTitle>
            <EmptyDescription>Conecte um provedor, faça uma chamada ou ajuste os filtros para começar a monitorar.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {accounts.map((account) => {
            const provider = providerById.get(account.providerId)
            const status = statusCopy(account.status)
            const StatusIcon = status.icon
            const hasLimits = account.profile.requestLimit != null || account.profile.tokenLimit != null || account.profile.costLimitUsd != null
            return (
              <Card key={account.providerId} className="h-full">
                <CardHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderAvatar providerId={account.providerId} label={provider?.label ?? account.providerId} size={42} className="rounded-xl" />
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <span className="truncate">{provider?.label ?? account.providerId}</span>
                        <Badge variant={status.variant}><StatusIcon data-icon="inline-start" />{status.label}</Badge>
                      </CardTitle>
                      <CardDescription className="truncate">
                        {account.profile.label || "Conta principal"} · {WINDOW_LABELS[account.profile.windowHours] ?? `${account.profile.windowHours}h`}
                      </CardDescription>
                    </div>
                  </div>
                  <CardAction className="flex items-center gap-2">
                    <Button size="icon-sm" variant="ghost" onClick={() => openEditor(account)} aria-label={`Editar quota de ${provider?.label ?? account.providerId}`}>
                      <PencilIcon />
                    </Button>
                    <Switch checked={account.profile.isEnabled} onCheckedChange={(checked) => void updateEnabled(account, checked)} aria-label={`Monitorar ${provider?.label ?? account.providerId}`} />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <span>{account.models.length} {account.models.length === 1 ? "modelo observado" : "modelos observados"}</span>
                    <span>{formatReset(account.resetAt, account.profile.windowHours)}</span>
                  </div>
                  <div className="flex flex-col gap-4">
                    <QuotaMetric label="Requests" value={account.requests} limit={account.profile.requestLimit} />
                    <QuotaMetric label="Tokens" value={account.tokens} limit={account.profile.tokenLimit} />
                    <QuotaMetric label="Custo" value={account.costUsd} limit={account.profile.costLimitUsd} formatter={formatCurrency} />
                  </div>
                  {account.models.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-muted-foreground">Uso por modelo</p>
                      {account.models.slice(0, 5).map((model) => (
                        <div key={model.modelId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs">
                          <span className="truncate font-medium">{model.modelId}</span>
                          <span className="text-muted-foreground">{formatCompact(model.requests)} req.</span>
                          <span className="text-muted-foreground">{formatCompact(model.tokens)} tok.</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
                <CardFooter className="justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {hasLimits ? `${account.percentage ?? 0}% do maior limite utilizado` : "Defina os limites exibidos no painel do provedor"}
                  </span>
                  <Badge variant={account.errors > 0 ? "destructive" : "outline"}>
                    <ActivityIcon data-icon="inline-start" />{account.errors} erros
                  </Badge>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={editor != null} onOpenChange={(open) => { if (!open) setEditor(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar limites de quota</DialogTitle>
            <DialogDescription>
              Informe os limites do plano exibidos pelo provedor. O ModelHub compara esses valores com o consumo observado.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="quota-label">Nome da conta</FieldLabel>
                <Input id="quota-label" value={editor.label} onChange={(event) => setEditor({ ...editor, label: event.target.value })} placeholder="Ex.: Produção" />
              </Field>
              <Field>
                <FieldLabel>Janela de medição</FieldLabel>
                <Select value={editor.windowHours} onValueChange={(value) => setEditor({ ...editor, windowHours: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {Object.entries(WINDOW_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <FieldDescription>Use a mesma janela de renovação informada pelo provedor.</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="quota-requests">Requests</FieldLabel>
                  <Input id="quota-requests" inputMode="numeric" value={editor.requestLimit} onChange={(event) => setEditor({ ...editor, requestLimit: event.target.value })} placeholder="Sem limite" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quota-tokens">Tokens</FieldLabel>
                  <Input id="quota-tokens" inputMode="numeric" value={editor.tokenLimit} onChange={(event) => setEditor({ ...editor, tokenLimit: event.target.value })} placeholder="Sem limite" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quota-cost">Custo (USD)</FieldLabel>
                  <Input id="quota-cost" inputMode="decimal" value={editor.costLimitUsd} onChange={(event) => setEditor({ ...editor, costLimitUsd: event.target.value })} placeholder="Sem limite" />
                </Field>
              </div>
              <Field orientation="horizontal">
                <div className="flex flex-1 flex-col gap-1">
                  <FieldLabel htmlFor="quota-enabled">Monitoramento ativo</FieldLabel>
                  <FieldDescription>Inclui esta conta na atualização automática e nos alertas.</FieldDescription>
                </div>
                <Switch id="quota-enabled" checked={editor.isEnabled} onCheckedChange={(checked) => setEditor({ ...editor, isEnabled: checked })} />
              </Field>
            </FieldGroup>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => void removeLimits()} disabled={saving}>
              <Trash2Icon data-icon="inline-start" />Remover limites
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>Cancelar</Button>
              <Button onClick={() => void saveEditor()} disabled={saving}>
                {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                {saving ? "Salvando" : "Salvar limites"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
