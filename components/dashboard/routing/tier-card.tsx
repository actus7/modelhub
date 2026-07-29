"use client"

import { useState } from "react"
import {
  ArrowUpIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RoutingModelOption } from "@/lib/contracts"

import { ModelPicker } from "./model-picker"
import { ProviderAvatar } from "./provider-avatar"
import {
  MAX_SLOTS_PER_TIER,
  appendSlot,
  formatPricePer1M,
  healthBadge,
  moveSlot,
  replaceSlot,
  slotKey,
  type RoutingSlot,
} from "./routing-utils"

type TierCardProps = {
  /** Realce quando o simulador resolve a mensagem para esta lane. */
  active?: boolean
  description: string
  hint?: string
  models: RoutingModelOption[]
  modelIndex: Map<string, RoutingModelOption>
  onChange: (slots: RoutingSlot[]) => void
  slots: RoutingSlot[]
  title: string
}

export function TierCard({
  active = false,
  description,
  hint,
  models,
  modelIndex,
  onChange,
  slots,
  title,
}: TierCardProps) {
  // `null` = fechado; número = índice sendo trocado; "append" = novo fallback.
  const [pickerTarget, setPickerTarget] = useState<number | "append" | null>(
    null,
  )
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const usedKeys = new Set(slots.map(slotKey))
  const isFull = slots.length >= MAX_SLOTS_PER_TIER

  function handleDrop(target: number) {
    if (draggingIndex === null) return
    onChange(moveSlot(slots, draggingIndex, target))
    setDraggingIndex(null)
    setDropIndex(null)
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card/60 p-3 transition-colors",
        active
          ? "border-primary/70 ring-2 ring-primary/20"
          : "border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {hint ? (
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {slots.length > 0 ? (
          <button
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onChange([])}
            type="button"
          >
            <RotateCcwIcon className="size-3" />
            Limpar
          </button>
        ) : null}
      </div>

      {slots.length === 0 ? (
        <button
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 py-6 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setPickerTarget("append")}
          type="button"
        >
          <PlusIcon className="size-4" />
          Escolher modelo
        </button>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {slots.map((slot, index) => {
            const model = modelIndex.get(slotKey(slot))
            const price = formatPricePer1M(model)
            const health = healthBadge(model)
            const isPrimary = index === 0

            return (
              <li
                className={cn(
                  "rounded-lg border bg-background transition-opacity",
                  draggingIndex === index && "opacity-40",
                  dropIndex === index
                    ? "border-primary ring-1 ring-primary"
                    : "border-border",
                )}
                draggable
                key={slotKey(slot)}
                onDragEnd={() => {
                  setDraggingIndex(null)
                  setDropIndex(null)
                }}
                onDragLeave={() =>
                  setDropIndex((current) =>
                    current === index ? null : current,
                  )
                }
                onDragOver={(event) => {
                  if (draggingIndex === null) return
                  event.preventDefault()
                  setDropIndex(index)
                }}
                onDragStart={() => setDraggingIndex(index)}
                onDrop={(event) => {
                  event.preventDefault()
                  handleDrop(index)
                }}
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <GripVerticalIcon className="size-3.5 shrink-0 cursor-grab text-muted-foreground/60" />
                  <ProviderAvatar
                    label={model?.providerLabel ?? slot.providerId}
                    providerId={slot.providerId}
                    size={16}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium"
                    title={slot.modelId}
                  >
                    {model?.modelName ?? slot.modelId}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      isPrimary
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {`${index + 1}º`}
                  </span>

                  {!isPrimary ? (
                    <button
                      aria-label={`Promover ${model?.modelName ?? slot.modelId} uma posição`}
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={() =>
                        onChange(moveSlot(slots, index, index - 1))
                      }
                      type="button"
                    >
                      <ArrowUpIcon className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    aria-label={`Trocar ${model?.modelName ?? slot.modelId}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => setPickerTarget(index)}
                    type="button"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    aria-label={`Remover ${model?.modelName ?? slot.modelId}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() =>
                      onChange(slots.filter((_, i) => i !== index))
                    }
                    type="button"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                    {price ??
                      `${model?.providerLabel ?? slot.providerId} · preço não catalogado`}
                  </span>
                  {health ? (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold",
                        health.tone === "bad" &&
                          "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                        health.tone === "warn" &&
                          "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        health.tone === "good" &&
                          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      )}
                      title={health.title}
                    >
                      {health.label}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {slots.length > 0 ? (
        <Button
          className="h-7 justify-start px-2 text-[11px] text-muted-foreground"
          disabled={isFull}
          onClick={() => setPickerTarget("append")}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon data-icon="inline-start" />
          {isFull
            ? `Máximo de ${MAX_SLOTS_PER_TIER} modelos`
            : "Adicionar fallback"}
        </Button>
      ) : null}

      <ModelPicker
        description={
          pickerTarget === "append" && slots.length > 0
            ? "O fallback é usado quando o modelo acima falha ou está indisponível."
            : description
        }
        models={models}
        onOpenChange={(open) => {
          if (!open) setPickerTarget(null)
        }}
        onSelect={(slot) => {
          if (pickerTarget === "append") onChange(appendSlot(slots, slot))
          else if (typeof pickerTarget === "number")
            onChange(replaceSlot(slots, pickerTarget, slot))
        }}
        open={pickerTarget !== null}
        title={`${title} — escolher modelo`}
        usedKeys={usedKeys}
      />
    </div>
  )
}
