"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, Loader2Icon, RouteIcon } from "lucide-react";
import { toast } from "sonner";

import { useAppState } from "@/components/app-state-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type { ProviderModel, RoutingConfigSummary, TierAssignment } from "@/lib/contracts";

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


function ModelSelector({
  providerId,
  modelId,
  providers,
  onChange,
}: {
  providerId: string;
  modelId: string;
  providers: Array<{ id: string; label: string; base: string; hasModels: boolean; localModels?: ProviderModel[] }>;
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
        value={providerId}
        onValueChange={(v) => onChange(v, "")}
      >
        <SelectTrigger className="flex-1 text-xs">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="">Nenhum</SelectItem>
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

export function RoutingSection() {
  const { providers } = useAppState();
  const [, setConfig] = useState<RoutingConfigSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [complexityEnabled, setComplexityEnabled] = useState(false);
  const [taskRoutingEnabled, setTaskRoutingEnabled] = useState(false);
  const [tiers, setTiers] = useState<Record<string, TierAssignment>>({});
  const [taskOverrides, setTaskOverrides] = useState<Record<string, TierAssignment>>({});

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await apiJson<RoutingConfigSummary>("/user/routing-config");
        setConfig(data);
        setComplexityEnabled(data.complexityEnabled);
        setTaskRoutingEnabled(data.taskRoutingEnabled);
        setTiers(data.tiers ?? {});
        setTaskOverrides(data.taskOverrides ?? {});
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar configuração de routing.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setTierAssignment(tierId: string, providerId: string, modelId: string) {
    setTiers((prev) => ({
      ...prev,
      [tierId]: { providerId, modelId },
    }));
  }

  function setTaskAssignment(taskId: string, providerId: string, modelId: string) {
    setTaskOverrides((prev) => {
      if (!providerId) {
        const next = { ...prev };
        delete next[taskId];
        return next;
      }
      return { ...prev, [taskId]: { providerId, modelId } };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await apiJsonRequest<RoutingConfigSummary>("/user/routing-config", "PATCH", {
        complexityEnabled,
        taskRoutingEnabled,
        tiers,
        taskOverrides,
      });
      setConfig(updated);
      toast.success("Configuração de routing salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar routing.");
    } finally {
      setSaving(false);
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

  const availableProviders = providers.filter((p) => p.hasModels);

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
            <CardTitle>Modelos por tier de complexidade</CardTitle>
            <CardDescription>
              Defina qual modelo usar para cada nível. Tiers sem modelo configurado usam o default do provider.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {TIERS.map((tier) => (
                <div key={tier.id} className="grid items-start gap-2 sm:grid-cols-[160px_1fr]">
                  <div className="pt-2">
                    <p className="text-sm font-medium">{tier.label}</p>
                    <p className="text-xs text-muted-foreground">{tier.description}</p>
                  </div>
                  <ModelSelector
                    providerId={tiers[tier.id]?.providerId ?? ""}
                    modelId={tiers[tier.id]?.modelId ?? ""}
                    providers={availableProviders}
                    onChange={(pId, mId) => setTierAssignment(tier.id, pId, mId)}
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
                <div key={task.id} className="grid items-center gap-2 sm:grid-cols-[160px_1fr]">
                  <p className="text-sm font-medium">{task.label}</p>
                  <ModelSelector
                    providerId={taskOverrides[task.id]?.providerId ?? ""}
                    modelId={taskOverrides[task.id]?.modelId ?? ""}
                    providers={availableProviders}
                    onChange={(pId, mId) => setTaskAssignment(task.id, pId, mId)}
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
        <Button disabled={saving} onClick={() => void handleSave()}>
          {saving && <Loader2Icon className="mr-2 size-3 animate-spin" />}
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}
