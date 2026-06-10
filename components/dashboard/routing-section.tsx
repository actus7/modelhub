"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, Loader2Icon, PlusIcon, RouteIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type { ProviderModel, RoutingConfigSummary, TierAssignment, UiProvider } from "@/lib/contracts";

const TIERS = [
  { id: "simple", label: "Simples", description: "Perguntas diretas, bate-papo casual" },
  { id: "standard", label: "Padrão", description: "Texto, código simples, análises" },
  { id: "complex", label: "Complexo", description: "Raciocínio multi-etapa, pesquisa" },
  { id: "reasoning", label: "Raciocínio", description: "Matemática avançada, planejamento" },
] as const;

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
] as const;

const NO_PROVIDER_VALUE = "__none__";
const MAX_FALLBACKS = 2;

type ProviderOption = {
  id: string;
  label: string;
  base: string;
  hasModels: boolean;
  localModels?: ProviderModel[];
};

function emptyAssignment(): TierAssignment {
  return { providerId: "", modelId: "", fallbacks: [] };
}

function dedupeFallbacks(
  assignment: TierAssignment,
  availableProviderIds: Set<string>,
): NonNullable<TierAssignment["fallbacks"]> {
  const primaryKey = `${assignment.providerId.toLowerCase()}/${assignment.modelId.toLowerCase()}`;
  const seen = new Set([primaryKey]);
  const fallbacks: NonNullable<TierAssignment["fallbacks"]> = [];

  for (const fallback of assignment.fallbacks ?? []) {
    if (!fallback.providerId) continue;
    if (!availableProviderIds.has(fallback.providerId)) continue;
    const key = `${fallback.providerId.toLowerCase()}/${fallback.modelId.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push({ providerId: fallback.providerId, modelId: fallback.modelId });
  }

  return fallbacks;
}

function compactAssignment(
  assignment: TierAssignment | undefined,
  availableProviderIds: Set<string>,
): TierAssignment | null {
  if (!assignment?.providerId) return null;
  if (!availableProviderIds.has(assignment.providerId)) return null;

  const compacted: TierAssignment = {
    providerId: assignment.providerId,
    modelId: assignment.modelId,
  };
  const fallbacks = dedupeFallbacks(assignment, availableProviderIds);
  if (fallbacks.length > 0) compacted.fallbacks = fallbacks;
  return compacted;
}

function compactAssignmentMap(
  assignments: Record<string, TierAssignment>,
  availableProviderIds: Set<string>,
): Record<string, TierAssignment> {
  return Object.fromEntries(
    Object.entries(assignments)
      .map(([key, assignment]) => [key, compactAssignment(assignment, availableProviderIds)] as const)
      .filter((entry): entry is [string, TierAssignment] => entry[1] !== null),
  );
}

function ModelSelector({
  providerId,
  modelId,
  providers,
  onChange,
}: {
  providerId: string;
  modelId: string;
  providers: ProviderOption[];
  onChange: (providerId: string, modelId: string) => void;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const selectedProvider = providers.find((p) => p.id === providerId);

  useEffect(() => {
    if (!selectedProvider) {
      setModels([]);
      return;
    }

    if (selectedProvider.localModels?.length) {
      setModels(selectedProvider.localModels);
      return;
    }

    if (!selectedProvider.hasModels) {
      setModels([]);
      return;
    }

    let cancelled = false;
    setLoadingModels(true);
    apiJson<{ models: ProviderModel[] }>(`${selectedProvider.base}/api/models`)
      .then((p) => {
        if (!cancelled) setModels(p.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });

    return () => { cancelled = true; };
  }, [selectedProvider]);

  return (
    <div className="flex gap-2">
      <Select
        value={providerId || NO_PROVIDER_VALUE}
        onValueChange={(v) => onChange(v === NO_PROVIDER_VALUE ? "" : v, "")}
      >
        <SelectTrigger className="flex-1 text-xs">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NO_PROVIDER_VALUE}>Nenhum</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={modelId}
        onValueChange={(v) => onChange(providerId, v)}
        disabled={!providerId || (loadingModels ? false : models.length === 0)}
      >
        <SelectTrigger className="flex-1 text-xs">
          <SelectValue placeholder={loadingModels ? "Carregando…" : "Modelo"} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function RoutingAssignmentEditor({
  assignment,
  providers,
  onChange,
}: {
  assignment: TierAssignment | undefined;
  providers: ProviderOption[];
  onChange: (assignment: TierAssignment) => void;
}) {
  const current = assignment ?? emptyAssignment();
  const fallbacks = current.fallbacks ?? [];

  function setPrimary(providerId: string, modelId: string) {
    onChange({ ...current, providerId, modelId });
  }

  function setFallback(index: number, providerId: string, modelId: string) {
    const nextFallbacks = [...fallbacks];
    nextFallbacks[index] = { providerId, modelId };
    onChange({ ...current, fallbacks: nextFallbacks });
  }

  function removeFallback(index: number) {
    onChange({ ...current, fallbacks: fallbacks.filter((_, i) => i !== index) });
  }

  function addFallback() {
    if (fallbacks.length >= MAX_FALLBACKS) return;
    onChange({ ...current, fallbacks: [...fallbacks, { providerId: "", modelId: "" }] });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Principal</p>
        <ModelSelector
          providerId={current.providerId}
          modelId={current.modelId}
          providers={providers}
          onChange={setPrimary}
        />
      </div>

      {fallbacks.map((fallback, index) => (
        <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fallback {index + 1}
            </p>
            <ModelSelector
              providerId={fallback.providerId}
              modelId={fallback.modelId}
              providers={providers}
              onChange={(providerId, modelId) => setFallback(index, providerId, modelId)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remover fallback ${index + 1}`}
            onClick={() => removeFallback(index)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!current.providerId || fallbacks.length >= MAX_FALLBACKS}
          onClick={addFallback}
        >
          <PlusIcon data-icon="inline-start" />
          Adicionar fallback
        </Button>
      </div>
    </div>
  );
}

export function RoutingSection() {
  const [, setConfig] = useState<RoutingConfigSummary | null>(null);
  const [routingProviders, setRoutingProviders] = useState<UiProvider[]>([]);
  const [routingProvidersLoaded, setRoutingProvidersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [complexityEnabled, setComplexityEnabled] = useState(false);
  const [taskRoutingEnabled, setTaskRoutingEnabled] = useState(false);
  const [tiers, setTiers] = useState<Record<string, TierAssignment>>({});
  const [taskOverrides, setTaskOverrides] = useState<Record<string, TierAssignment>>({});
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [data, routingProviderData] = await Promise.all([
          apiJson<RoutingConfigSummary>("/user/routing-config"),
          apiJson<{ providers: UiProvider[] }>("/user/routing-config/providers"),
        ]);
        const nextRoutingProviders = routingProviderData.providers ?? [];
        const nextProviderIds = new Set(nextRoutingProviders.map((provider) => provider.id));
        setConfig(data);
        setRoutingProviders(nextRoutingProviders);
        setRoutingProvidersLoaded(true);
        setComplexityEnabled(data.complexityEnabled);
        setTaskRoutingEnabled(data.taskRoutingEnabled);
        setTiers(compactAssignmentMap(data.tiers ?? {}, nextProviderIds));
        setTaskOverrides(compactAssignmentMap(data.taskOverrides ?? {}, nextProviderIds));
      } catch (e) {
        setRoutingProviders([]);
        setRoutingProvidersLoaded(false);
        toast.error(e instanceof Error ? e.message : "Falha ao carregar configuração de routing.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setTierAssignment(tierId: string, assignment: TierAssignment) {
    setTiers((prev) => ({
      ...prev,
      [tierId]: assignment,
    }));
  }

  function setTaskAssignment(taskId: string, assignment: TierAssignment) {
    setTaskOverrides((prev) => {
      if (!assignment.providerId) {
        const next = { ...prev };
        delete next[taskId];
        return next;
      }
      return { ...prev, [taskId]: assignment };
    });
  }

  async function handleSave() {
    if (!routingProvidersLoaded) {
      toast.error("Não foi possível validar os providers configurados para routing.");
      return;
    }

    setSaving(true);
    try {
      const availableProviderIds = new Set(routingProviders.map((provider) => provider.id));
      const compactTiers = compactAssignmentMap(tiers, availableProviderIds);
      const compactTaskOverrides = compactAssignmentMap(taskOverrides, availableProviderIds);
      const updated = await apiJsonRequest<RoutingConfigSummary>("/user/routing-config", "PATCH", {
        complexityEnabled,
        taskRoutingEnabled,
        tiers: compactTiers,
        taskOverrides: compactTaskOverrides,
      });
      setConfig(updated);
      setTiers(compactAssignmentMap(updated.tiers ?? compactTiers, availableProviderIds));
      setTaskOverrides(compactAssignmentMap(updated.taskOverrides ?? compactTaskOverrides, availableProviderIds));
      toast.success("Configuração de routing salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar routing.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggestTiers() {
    setSuggesting(true);
    try {
      const data = await apiJson<{ tiers: Record<string, TierAssignment> }>("/user/routing-config/suggest");
      if (!data.tiers || Object.keys(data.tiers).length === 0) {
        toast.error("Nenhum modelo disponível para sugerir. Conecte provedores primeiro.");
        return;
      }
      setTiers((prev) => {
        const next = { ...prev };
        for (const [tierId, assignment] of Object.entries(data.tiers)) {
          next[tierId] = { ...assignment, fallbacks: prev[tierId]?.fallbacks ?? [] };
        }
        return next;
      });
      toast.success("Modelos sugeridos preenchidos. Revise e salve.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sugerir modelos.");
    } finally {
      setSuggesting(false);
    }
  }

  function handleCopySnippet() {
    const snippet = `curl -X POST https://www.modelhub.com.br/v1/chat/completions \\
  -H "Authorization: Bearer $MODELHUB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Sua pergunta aqui"}]}'`;
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      toast.success("Snippet copiado!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const readyProviders = routingProvidersLoaded ? routingProviders : [];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RouteIcon className="size-4" />
            Roteamento automático
          </CardTitle>
          <CardDescription>
            Com o modelo <code className="rounded bg-muted px-1 py-0.5 text-xs">auto</code>, o ModelHub escolhe o
            modelo ideal para cada mensagem automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={complexityEnabled}
                onChange={(e) => setComplexityEnabled(e.target.checked)}
              />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Roteamento por complexidade</p>
                <p className="text-xs text-muted-foreground">
                  Analisa localmente cada mensagem e encaminha para o tier adequado (&lt;2ms, sem chamada externa).
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={taskRoutingEnabled}
                onChange={(e) => setTaskRoutingEnabled(e.target.checked)}
              />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Roteamento por categoria de tarefa</p>
                <p className="text-xs text-muted-foreground">
                  Detecta a intenção (programação, e-mail, análise de dados…) e usa o modelo especializado configurado.
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {complexityEnabled && (
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Modelos por tier de complexidade</CardTitle>
                <CardDescription>
                  Defina o modelo primário e a ordem de fallback para cada nível.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={suggesting || readyProviders.length === 0}
                onClick={() => void handleSuggestTiers()}
              >
                {suggesting && <Loader2Icon className="mr-2 size-3 animate-spin" />}
                Sugerir automaticamente
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {TIERS.map((tier) => (
                <div key={tier.id} className="grid items-start gap-2 sm:grid-cols-[160px_1fr]">
                  <div className="pt-2">
                    <p className="text-sm font-medium">{tier.label}</p>
                    <p className="text-xs text-muted-foreground">{tier.description}</p>
                  </div>
                  <RoutingAssignmentEditor
                    assignment={tiers[tier.id]}
                    providers={readyProviders}
                    onChange={(assignment) => setTierAssignment(tier.id, assignment)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {taskRoutingEnabled && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Modelos por categoria de tarefa</CardTitle>
            <CardDescription>
              Substitui o tier de complexidade quando a intenção da mensagem for detectada com confiança ≥ 40%.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {TASK_CATEGORIES.map((task) => (
                <div key={task.id} className="grid items-start gap-2 sm:grid-cols-[160px_1fr]">
                  <p className="pt-2 text-sm font-medium">{task.label}</p>
                  <RoutingAssignmentEditor
                    assignment={taskOverrides[task.id]}
                    providers={readyProviders}
                    onChange={(assignment) => setTaskAssignment(task.id, assignment)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Usar modelo &quot;auto&quot; na API</CardTitle>
          <CardDescription>Substitua o model_id pela string literal <code className="rounded bg-muted px-1 py-0.5 text-xs">auto</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed">
            <code>{`curl -X POST https://www.modelhub.com.br/v1/chat/completions \\
  -H "Authorization: Bearer $MODELHUB_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Sua pergunta aqui"}]}'`}</code>
          </pre>
          <Button variant="outline" size="sm" onClick={handleCopySnippet}>
            {copied ? <CheckIcon className="mr-2 size-3" /> : <CopyIcon className="mr-2 size-3" />}
            Copiar snippet
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={saving || !routingProvidersLoaded} onClick={() => void handleSave()}>
          {saving && <Loader2Icon className="mr-2 size-3 animate-spin" />}
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}
