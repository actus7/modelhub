import type { RoutingModelOption, TierAssignment } from "@/lib/contracts"

/** Um modelo posicionado numa lane de roteamento. Índice 0 = principal, resto = fallbacks. */
export type RoutingSlot = {
  providerId: string
  modelId: string
}

/** 1 principal + 9 fallbacks por lane. */
export const MAX_SLOTS_PER_TIER = 10

/**
 * A API guarda `{ providerId, modelId, fallbacks[] }`, mas a UI manipula uma
 * lista única e ordenável. Converter nas bordas deixa arrastar/remover como
 * simples operações de array.
 */
export function toSlots(assignment: TierAssignment | undefined): RoutingSlot[] {
  if (!assignment?.providerId) return []
  const fallbacks = (assignment.fallbacks ?? []).filter(
    (fallback) => fallback.providerId,
  )
  return [
    { providerId: assignment.providerId, modelId: assignment.modelId },
    ...fallbacks,
  ]
}

export function toAssignment(slots: RoutingSlot[]): TierAssignment | undefined {
  const [primary, ...fallbacks] = slots.filter((slot) => slot.providerId)
  if (!primary) return undefined
  if (fallbacks.length === 0)
    return { providerId: primary.providerId, modelId: primary.modelId }
  return {
    providerId: primary.providerId,
    modelId: primary.modelId,
    fallbacks: fallbacks.map((slot) => ({
      providerId: slot.providerId,
      modelId: slot.modelId,
    })),
  }
}

export function moveSlot(
  slots: RoutingSlot[],
  from: number,
  to: number,
): RoutingSlot[] {
  if (from === to) return slots
  if (from < 0 || to < 0 || from >= slots.length || to >= slots.length)
    return slots
  const next = [...slots]
  const [moved] = next.splice(from, 1)
  if (!moved) return slots
  next.splice(to, 0, moved)
  return next
}

export function slotKey(slot: RoutingSlot): string {
  return `${slot.providerId.toLowerCase()}/${slot.modelId.toLowerCase()}`
}

/** Impede o mesmo modelo duas vezes na mesma lane (fallback que nunca ajuda). */
export function appendSlot(
  slots: RoutingSlot[],
  slot: RoutingSlot,
): RoutingSlot[] {
  if (slots.some((existing) => slotKey(existing) === slotKey(slot)))
    return slots
  if (slots.length >= MAX_SLOTS_PER_TIER) return slots
  return [...slots, slot]
}

export function replaceSlot(
  slots: RoutingSlot[],
  index: number,
  slot: RoutingSlot,
): RoutingSlot[] {
  const duplicateAt = slots.findIndex(
    (existing) => slotKey(existing) === slotKey(slot),
  )
  if (duplicateAt !== -1 && duplicateAt !== index) return slots
  return slots.map((existing, i) => (i === index ? slot : existing))
}

function formatUsd(value: number): string {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`
}

/** Rodapé do chip: preço por 1M de tokens, ou null quando o preço é desconhecido. */
export function formatPricePer1M(
  model: RoutingModelOption | undefined,
): string | null {
  if (!model) return null
  if (model.inputPer1M === null && model.outputPer1M === null) return null
  const input = model.inputPer1M === null ? "—" : formatUsd(model.inputPer1M)
  const output = model.outputPer1M === null ? "—" : formatUsd(model.outputPer1M)
  return `${input} entrada · ${output} saída / 1M`
}

/**
 * Custo relativo dentro do catálogo, para o selo de preço no picker.
 * Usa o preço de saída, que domina o gasto real de chat.
 */
export function costBand(
  model: RoutingModelOption,
  maxOutputPer1M: number,
): "free" | "low" | "mid" | "high" | "unknown" {
  if (model.outputPer1M === null) return "unknown"
  if (model.outputPer1M === 0) return "free"
  if (maxOutputPer1M <= 0) return "unknown"
  const ratio = model.outputPer1M / maxOutputPer1M
  if (ratio <= 0.1) return "low"
  if (ratio <= 0.4) return "mid"
  return "high"
}

/**
 * Vários providers já devolvem `name` com o próprio rótulo no fim
 * ("zai-glm-4.7 (Cerebras)"). Numa lista agrupada por provider isso repete a
 * mesma palavra três vezes por linha, então o sufixo redundante sai.
 */
export function cleanModelName(
  modelName: string,
  providerLabel: string,
): string {
  const suffix = ` (${providerLabel})`
  const cleaned = modelName.endsWith(suffix)
    ? modelName.slice(0, -suffix.length)
    : modelName
  return cleaned.trim() || modelName
}

export type HealthBadge = {
  label: string
  tone: "good" | "warn" | "bad"
  title: string
}

/**
 * Selo de saúde observada. Retorna null sem histórico suficiente — um modelo
 * novo não pode parecer ruim só por falta de dados.
 */
export function healthBadge(
  model: RoutingModelOption | undefined,
): HealthBadge | null {
  const health = model?.health
  if (!health || health.total < 5) return null

  const successPct = Math.round((1 - health.errorRate) * 100)
  const latency =
    health.avgDurationMs === null
      ? ""
      : ` · ${(health.avgDurationMs / 1000).toFixed(1)}s média`
  const title = `${successPct}% de sucesso em ${health.total} requisições${latency}`

  let tone: HealthBadge["tone"] = "good"
  if (health.errorRate >= 0.5) tone = "bad"
  else if (health.errorRate >= 0.05) tone = "warn"

  return { label: `${successPct}% ok`, tone, title }
}

/** Hue determinístico para o avatar do provider (o repo não versiona logos). */
export function providerHue(providerId: string): number {
  let hash = 0
  for (let index = 0; index < providerId.length; index += 1) {
    hash = (hash * 31 + providerId.charCodeAt(index)) % 360
  }
  return hash
}

export function buildModelIndex(
  models: RoutingModelOption[],
): Map<string, RoutingModelOption> {
  return new Map(
    models.map((model) => [
      slotKey({ providerId: model.providerId, modelId: model.modelId }),
      model,
    ]),
  )
}
