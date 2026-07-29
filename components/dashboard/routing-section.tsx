"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  RouteIcon,
  SparklesIcon,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

import { SuggestionPreview } from "@/components/dashboard/routing/suggestion-preview"
import { TierCard } from "@/components/dashboard/routing/tier-card"
import {
  buildModelIndex,
  slotKey,
  toAssignment,
  toSlots,
  type RoutingSlot,
} from "@/components/dashboard/routing/routing-utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { apiJson, apiJsonRequest } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  RoutingConfigSummary,
  RoutingModelCatalog,
  RoutingModelOption,
  RoutingSuggestion,
  TierAssignment,
  UiProvider,
} from "@/lib/contracts"
import {
  scoreComplexity,
  type RoutingTier,
} from "@/server/lib/routing/complexity-scorer"

const TIERS = [
  {
    id: "simple",
    label: "Simples",
    hint: "score 0–15",
    description:
      "Perguntas diretas e bate-papo casual. Use o modelo mais barato aqui.",
  },
  {
    id: "standard",
    label: "Padrão",
    hint: "score 16–40",
    description: "Texto do dia a dia, código simples, resumos.",
  },
  {
    id: "complex",
    label: "Complexo",
    hint: "score 41–65",
    description: "Raciocínio multi-etapa, análise, contexto longo.",
  },
  {
    id: "reasoning",
    label: "Raciocínio",
    hint: "score 66+",
    description: "Matemática, lógica formal, planejamento profundo.",
  },
] as const

const TASK_CATEGORIES = [
  { id: "coding", label: "Programação" },
  { id: "data_analysis", label: "Análise de dados" },
  { id: "web_browsing", label: "Navegação web" },
  { id: "image_generation", label: "Geração de imagem" },
  { id: "video_generation", label: "Geração de vídeo" },
  { id: "email", label: "E-mail" },
  { id: "calendar", label: "Calendário" },
  { id: "social_media", label: "Redes sociais" },
  { id: "trading", label: "Trading" },
] as const

const SNIPPET = `curl -X POST https://www.modelhub.com.br/v1/chat/completions \\
  -H "Authorization: Bearer $MODELHUB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Sua pergunta aqui"}]}'`

const AUTOSAVE_DELAY_MS = 700

type SaveState = "idle" | "saving" | "saved" | "error"

export function RoutingSection() {
  const [providers, setProviders] = useState<UiProvider[]>([])
  const [catalog, setCatalog] = useState<RoutingModelOption[]>([])
  const [failedProviders, setFailedProviders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [copied, setCopied] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  const [complexityEnabled, setComplexityEnabled] = useState(false)
  const [taskRoutingEnabled, setTaskRoutingEnabled] = useState(false)
  const [tiers, setTiers] = useState<Record<string, TierAssignment>>({})
  const [taskOverrides, setTaskOverrides] = useState<
    Record<string, TierAssignment>
  >({})

  const [probe, setProbe] = useState("")
  /** Sugestão pendente de confirmação; `null` = nenhum preview aberto. */
  const [suggestion, setSuggestion] = useState<
    RoutingSuggestion["tiers"] | null
  >(null)

  // Não dispara autosave no primeiro render nem enquanto a config inicial carrega.
  const hydratedRef = useRef(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const [config, providerData, modelData] = await Promise.all([
          apiJson<RoutingConfigSummary>("/user/routing-config"),
          apiJson<{ providers: UiProvider[] }>(
            "/user/routing-config/providers",
          ),
          apiJson<RoutingModelCatalog>("/user/routing-config/models"),
        ])
        setComplexityEnabled(config.complexityEnabled)
        setTaskRoutingEnabled(config.taskRoutingEnabled)
        // O servidor já sanitiza tiers/overrides contra os providers prontos
        // (getRoutingConfig → sanitizeRoutingMap), então a UI confia no payload.
        setTiers(config.tiers ?? {})
        setTaskOverrides(config.taskOverrides ?? {})
        setProviders(providerData.providers ?? [])
        setCatalog(modelData.models ?? [])
        setFailedProviders(modelData.failedProviders ?? [])
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Falha ao carregar a configuração de roteamento.",
        )
      } finally {
        setLoading(false)
        hydratedRef.current = true
      }
    })()
  }, [])

  // Autosave: o botão "Salvar" antigo ficava no fim de uma página longa e
  // silenciosamente perdia o trabalho de quem não rolava até lá.
  useEffect(() => {
    if (!hydratedRef.current) return

    setSaveState("saving")
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await apiJsonRequest<RoutingConfigSummary>(
            "/user/routing-config",
            "PATCH",
            {
              complexityEnabled,
              taskRoutingEnabled,
              tiers,
              taskOverrides,
            },
          )
          setSaveState("saved")
        } catch (error) {
          setSaveState("error")
          toast.error(
            error instanceof Error
              ? error.message
              : "Falha ao salvar o roteamento.",
          )
        }
      })()
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [complexityEnabled, taskRoutingEnabled, tiers, taskOverrides])

  const modelIndex = useMemo(() => buildModelIndex(catalog), [catalog])

  function writeAssignment(
    setter: typeof setTiers,
    key: string,
    slots: RoutingSlot[],
  ) {
    setter((previous) => {
      const assignment = toAssignment(slots)
      if (!assignment) {
        const next = { ...previous }
        delete next[key]
        return next
      }
      return { ...previous, [key]: assignment }
    })
  }

  async function handleSuggest() {
    setSuggesting(true)
    try {
      const data = await apiJson<RoutingSuggestion>(
        "/user/routing-config/suggest",
      )
      if (!data.tiers || Object.keys(data.tiers).length === 0) {
        toast.error(
          "Nenhum modelo disponível para sugerir. Conecte provedores primeiro.",
        )
        return
      }
      // Preview em vez de aplicar direto: a versão anterior sobrescrevia os
      // principais sem aviso e sem explicar o critério da escolha.
      setSuggestion(data.tiers)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao sugerir modelos.",
      )
    } finally {
      setSuggesting(false)
    }
  }

  function applySuggestion() {
    if (!suggestion) return
    setTiers((previous) => {
      const next = { ...previous }
      for (const [tierId, slots] of Object.entries(suggestion)) {
        const assignment = toAssignment(slots)
        if (assignment) next[tierId] = assignment
      }
      return next
    })
    setSuggestion(null)
    toast.success("Sugestão aplicada. Ajuste o que quiser — salva sozinho.")
  }

  function handleCopySnippet() {
    void navigator.clipboard.writeText(SNIPPET).then(() => {
      setCopied(true)
      toast.success("Snippet copiado!")
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (providers.length === 0) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RouteIcon className="size-4" />
            Roteamento automático
          </CardTitle>
          <CardDescription>
            Nenhum provedor está pronto para roteamento ainda. Conecte pelo
            menos um provedor com credenciais válidas para escolher os modelos
            de cada nível.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm">
            <Link href="/setup">
              Conectar provedores
              <ExternalLinkIcon data-icon="inline-end" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const probeScore = probe.trim()
    ? scoreComplexity([{ role: "user", content: probe }])
    : null
  const activeTier: RoutingTier | null = probeScore?.tier ?? null
  const resolvedSlots = activeTier ? toSlots(tiers[activeTier]) : []
  const resolvedPrimary = resolvedSlots[0]
  const resolvedModel = resolvedPrimary
    ? modelIndex.get(slotKey(resolvedPrimary))
    : undefined

  const unusedCategories = TASK_CATEGORIES.filter(
    (task) => !taskOverrides[task.id],
  )
  const usedCategories = TASK_CATEGORIES.filter(
    (task) => taskOverrides[task.id],
  )

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <RouteIcon className="size-4" />
            Roteamento automático
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Chame a API com{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              &quot;model&quot;: &quot;auto&quot;
            </code>{" "}
            e o ModelHub escolhe o modelo de cada mensagem seguindo as lanes
            abaixo.
          </p>
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {failedProviders.length > 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Não foi possível listar os modelos de: {failedProviders.join(", ")}.
          Modelos já configurados continuam funcionando, mas não aparecem no
          seletor até o provedor responder.
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Roteamento padrão</p>
            <p className="text-sm text-muted-foreground">
              {complexityEnabled
                ? "Analisa a complexidade de cada requisição na hora e envia para o nível correspondente (<2ms, sem chamada externa)."
                : "Escolha um modelo e até dois fallbacks como roteamento padrão."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {complexityEnabled ? (
              <Button
                disabled={suggesting}
                onClick={() => void handleSuggest()}
                size="sm"
                type="button"
                variant="outline"
              >
                {suggesting ? (
                  <Loader2Icon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <SparklesIcon data-icon="inline-start" />
                )}
                Sugerir modelos
              </Button>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              Rotear por complexidade
              <Switch
                checked={complexityEnabled}
                onCheckedChange={setComplexityEnabled}
              />
            </label>
          </div>
        </div>

        {complexityEnabled ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TIERS.map((tier) => (
              <TierCard
                active={activeTier === tier.id}
                description={tier.description}
                hint={tier.hint}
                key={tier.id}
                modelIndex={modelIndex}
                models={catalog}
                onChange={(slots) => writeAssignment(setTiers, tier.id, slots)}
                slots={toSlots(tiers[tier.id])}
                title={tier.label}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/40 p-4">
            <div className="max-w-sm">
              <TierCard
                description="Modelo usado em toda requisição com model: auto."
                hint="usado sempre"
                modelIndex={modelIndex}
                models={catalog}
                onChange={(slots) =>
                  writeAssignment(setTiers, "default", slots)
                }
                slots={toSlots(tiers.default)}
                title="Modelo padrão"
              />
            </div>
          </div>
        )}
      </section>

      {complexityEnabled ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-sm">Testar antes de confiar</CardTitle>
            <CardDescription>
              Cole uma mensagem real. O mesmo classificador que roda em produção
              mostra o nível escolhido e o porquê — sem gastar créditos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              onChange={(event) => setProbe(event.target.value)}
              placeholder="Ex.: prove que a soma dos n primeiros ímpares é n²"
              rows={3}
              value={probe}
            />
            {probeScore ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">
                  {TIERS.find((tier) => tier.id === probeScore.tier)?.label ??
                    probeScore.tier}
                </span>
                <span className="text-muted-foreground">
                  score {probeScore.rawScore} · confiança{" "}
                  {Math.round(probeScore.confidence * 100)}%
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">
                  {resolvedModel?.modelName ??
                    resolvedPrimary?.modelId ??
                    "nenhum modelo configurado nesse nível"}
                </span>
                {probeScore.signals.length > 0 ? (
                  <span className="w-full text-[11px] text-muted-foreground">
                    sinais: {probeScore.signals.join(", ")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Roteamento por categoria de tarefa
            </p>
            <p className="text-sm text-muted-foreground">
              Detecta a intenção da mensagem e, com confiança ≥ 40%, ignora o
              nível de complexidade e usa o modelo especializado.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
            Rotear por tarefa
            <Switch
              checked={taskRoutingEnabled}
              onCheckedChange={setTaskRoutingEnabled}
            />
          </label>
        </div>

        {taskRoutingEnabled ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {usedCategories.map((task) => (
              <TierCard
                description={`Modelo usado quando a mensagem for detectada como “${task.label}”.`}
                key={task.id}
                modelIndex={modelIndex}
                models={catalog}
                onChange={(slots) =>
                  writeAssignment(setTaskOverrides, task.id, slots)
                }
                slots={toSlots(taskOverrides[task.id])}
                title={task.label}
              />
            ))}
            {unusedCategories.length > 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3">
                <PlusIcon className="size-4 text-muted-foreground" />
                <Select
                  onValueChange={(taskId) =>
                    setTaskOverrides((previous) => ({
                      ...previous,
                      [taskId]: { providerId: "", modelId: "" },
                    }))
                  }
                  value=""
                >
                  <SelectTrigger className="text-xs" size="sm">
                    <SelectValue placeholder="Adicionar categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {unusedCategories.map((task) => (
                        <SelectItem key={task.id} value={task.id}>
                          {task.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-sm">Usar na API</CardTitle>
          <CardDescription>
            Substitua o model_id pela string literal{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">auto</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed">
            <code>{SNIPPET}</code>
          </pre>
          <Button onClick={handleCopySnippet} size="sm" variant="outline">
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            Copiar snippet
          </Button>
        </CardContent>
      </Card>

      <SuggestionPreview
        lanes={TIERS.map((tier) => ({
          currentCount: toSlots(tiers[tier.id]).length,
          hint: tier.hint,
          label: tier.label,
          slots: suggestion?.[tier.id] ?? [],
          tierId: tier.id,
        }))}
        modelIndex={modelIndex}
        onApply={applySuggestion}
        onOpenChange={(next) => {
          if (!next) setSuggestion(null)
        }}
        open={suggestion !== null}
      />
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null

  const copy = {
    saving: "Salvando…",
    saved: "Alterações salvas",
    error: "Falha ao salvar",
  }[state]

  return (
    <p
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saving" ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : null}
      {state === "saved" ? <CheckIcon className="size-3" /> : null}
      {copy}
    </p>
  )
}
