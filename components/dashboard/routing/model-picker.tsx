"use client"

import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { RoutingModelOption } from "@/lib/contracts"

import { ProviderAvatar } from "./provider-avatar"
import {
  cleanModelName,
  costBand,
  formatPricePer1M,
  slotKey,
  type RoutingSlot,
} from "./routing-utils"

const BAND_STYLE: Record<
  Exclude<ReturnType<typeof costBand>, "unknown">,
  { className: string; label: string }
> = {
  free: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "grátis",
  },
  low: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "barato",
  },
  mid: {
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    label: "médio",
  },
  high: {
    className: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    label: "caro",
  },
}

type ModelPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: RoutingModelOption[]
  /** Modelos já usados nesta lane — listados como desabilitados em vez de sumirem. */
  usedKeys: Set<string>
  title: string
  description: string
  onSelect: (slot: RoutingSlot) => void
}

export function ModelPicker({
  open,
  onOpenChange,
  models,
  usedKeys,
  title,
  description,
  onSelect,
}: Readonly<ModelPickerProps>) {
  const [query, setQuery] = useState("")
  const [providerFilter, setProviderFilter] = useState<string | null>(null)

  const providers = useMemo(() => {
    const counts = new Map<string, { label: string; total: number }>()
    for (const model of models) {
      const entry = counts.get(model.providerId)
      if (entry) entry.total += 1
      else
        counts.set(model.providerId, { label: model.providerLabel, total: 1 })
    }
    return [...counts]
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [models])

  const maxOutputPer1M = useMemo(
    () =>
      models.reduce((max, model) => Math.max(max, model.outputPer1M ?? 0), 0),
    [models],
  )

  /** Agrupa por provider: o rótulo vira cabeçalho e some de cada linha. */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = models.filter((model) => {
      if (providerFilter && model.providerId !== providerFilter) return false
      if (!needle) return true
      return (
        model.modelId.toLowerCase().includes(needle) ||
        model.modelName.toLowerCase().includes(needle) ||
        model.providerLabel.toLowerCase().includes(needle)
      )
    })

    const byProvider = new Map<string, RoutingModelOption[]>()
    for (const model of matched) {
      const bucket = byProvider.get(model.providerId)
      if (bucket) bucket.push(model)
      else byProvider.set(model.providerId, [model])
    }

    return [...byProvider]
      .map(([providerId, items]) => ({
        providerId,
        providerLabel: items[0]?.providerLabel ?? providerId,
        // Mais barato primeiro: a escolha default de um router é economizar.
        items: [...items].sort(
          (a, b) => (a.outputPer1M ?? Infinity) - (b.outputPer1M ?? Infinity),
        ),
      }))
      .sort((a, b) => a.providerLabel.localeCompare(b.providerLabel))
  }, [models, providerFilter, query])

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  // Com um provider único em foco o cabeçalho de grupo só repetiria o rail.
  const showGroupHeaders = groups.length > 1

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("")
      setProviderFilter(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/*
        `DialogContent` é `grid` no shadcn deste repo. Sem forçar `flex` + uma
        altura máxima explícita aqui, a lista cresce sem limite e o modal
        estoura a viewport em vez de rolar.
      */}
      <DialogContent className="flex max-h-[80dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 gap-1 px-4 pt-4 pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0 p-4">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por modelo ou provedor…"
            value={query}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-border sm:flex-row">
          {providers.length > 1 ? (
            /*
              Rail vertical em vez da faixa horizontal anterior: sem roda
              horizontal, um mouse comum não alcançava os provedores fora da
              primeira dobra. Rolagem vertical funciona em qualquer mouse.
              Em telas estreitas vira uma linha que quebra (touch dá conta).
            */
            <div className="flex shrink-0 flex-wrap content-start gap-1 overflow-y-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
              <RailItem
                active={providerFilter === null}
                count={models.length}
                label="Todos os provedores"
                onClick={() => setProviderFilter(null)}
              />
              {providers.map((provider) => (
                <RailItem
                  active={providerFilter === provider.id}
                  count={provider.total}
                  key={provider.id}
                  label={provider.label}
                  onClick={() => setProviderFilter(provider.id)}
                  providerId={provider.id}
                />
              ))}
            </div>
          ) : null}

          {/* Rolagem nativa: não depende da altura herdada pelo viewport do Radix. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {total === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                Nenhum modelo encontrado
                {query.trim() ? ` para “${query.trim()}”` : ""}.
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.providerId}>
                  {showGroupHeaders ? (
                    <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-popover/95 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm">
                      <ProviderAvatar
                        label={group.providerLabel}
                        providerId={group.providerId}
                        size={14}
                      />
                      {group.providerLabel}
                      <span className="font-normal normal-case">
                        · {group.items.length}
                      </span>
                    </h3>
                  ) : null}
                  <ul>
                    {group.items.map((model) => {
                      const key = slotKey({
                        providerId: model.providerId,
                        modelId: model.modelId,
                      })
                      const used = usedKeys.has(key)
                      const band = costBand(model, maxOutputPer1M)
                      const price = formatPricePer1M(model)
                      const name = cleanModelName(
                        model.modelName,
                        model.providerLabel,
                      )

                      return (
                        <li key={key}>
                          <button
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                              used
                                ? "cursor-not-allowed opacity-40"
                                : "hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                            )}
                            disabled={used}
                            onClick={() => {
                              onSelect({
                                providerId: model.providerId,
                                modelId: model.modelId,
                              })
                              handleOpenChange(false)
                            }}
                            type="button"
                          >
                            <span
                              className="min-w-0 flex-1 truncate text-sm"
                              title={model.modelId}
                            >
                              {name}
                            </span>

                            {used ? (
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                já usado
                              </span>
                            ) : (
                              <>
                                {price ? (
                                  <span className="hidden shrink-0 text-[11px] text-muted-foreground tabular-nums sm:block">
                                    {price}
                                  </span>
                                ) : null}
                                {/* Sem preço conhecido não há selo: um "n/d" cinza
                                    em toda linha só adicionava ruído. */}
                                {band !== "unknown" ? (
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                      BAND_STYLE[band].className,
                                    )}
                                  >
                                    {BAND_STYLE[band].label}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RailItem({
  active,
  count,
  label,
  onClick,
  providerId,
}: Readonly<{
  active: boolean
  count: number
  label: string
  onClick: () => void
  providerId?: string
}>) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex w-full shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors max-sm:w-auto",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {providerId ? (
        <ProviderAvatar label={label} providerId={providerId} size={14} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={cn("tabular-nums", active ? "opacity-70" : "opacity-50")}
      >
        {count}
      </span>
    </button>
  )
}
