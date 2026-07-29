"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { RoutingModelOption, RoutingSuggestedSlot } from "@/lib/contracts"

import { ProviderAvatar } from "./provider-avatar"
import { cleanModelName, slotKey } from "./routing-utils"

type SuggestionLane = {
  tierId: string
  label: string
  hint?: string
  slots: RoutingSuggestedSlot[]
  /** Quantos modelos a lane já tem hoje — vira aviso de substituição. */
  currentCount: number
}

type SuggestionPreviewProps = {
  lanes: SuggestionLane[]
  modelIndex: Map<string, RoutingModelOption>
  onApply: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function SuggestionPreview({
  lanes,
  modelIndex,
  onApply,
  onOpenChange,
  open,
}: Readonly<SuggestionPreviewProps>) {
  const totalSlots = lanes.reduce((sum, lane) => sum + lane.slots.length, 0)
  const replacing = lanes.filter((lane) => lane.currentCount > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 gap-1 px-4 pt-4 pr-12 text-left">
          <DialogTitle>Sugestão de modelos</DialogTitle>
          <DialogDescription className="text-xs">
            Ranqueado por contagem de parâmetros e família do modelo, com preço
            como desempate quando conhecido. Fallbacks priorizam provedores
            diferentes do principal.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {totalSlots === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum modelo elegível encontrado nos provedores conectados.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {lanes.map((lane) => (
                <section key={lane.tierId}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{lane.label}</h3>
                    {lane.hint ? (
                      <span className="text-[11px] text-muted-foreground">
                        {lane.hint}
                      </span>
                    ) : null}
                    {lane.currentCount > 0 ? (
                      <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">
                        substitui {lane.currentCount}{" "}
                        {lane.currentCount === 1 ? "modelo" : "modelos"}
                      </span>
                    ) : null}
                  </div>

                  {lane.slots.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                      Nenhum modelo se qualificou para este nível.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-1">
                      {lane.slots.map((slot, index) => {
                        const model = modelIndex.get(slotKey(slot))
                        const name = model
                          ? cleanModelName(model.modelName, model.providerLabel)
                          : slot.modelId

                        return (
                          <li
                            className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                            key={`${slot.providerId}/${slot.modelId}`}
                          >
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                index === 0
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {index + 1}º
                            </span>
                            <ProviderAvatar
                              label={model?.providerLabel ?? slot.providerId}
                              providerId={slot.providerId}
                              size={16}
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-xs font-medium"
                              title={slot.modelId}
                            >
                              {name}
                            </span>
                            <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">
                              {slot.reason}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-[11px] text-muted-foreground">
            {replacing.length > 0
              ? `${replacing.length} ${replacing.length === 1 ? "nível já configurado será substituído" : "níveis já configurados serão substituídos"}.`
              : "Nenhuma configuração existente será perdida."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              onClick={() => onOpenChange(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={totalSlots === 0}
              onClick={onApply}
              size="sm"
              type="button"
            >
              Aplicar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
