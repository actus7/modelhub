"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2Icon,
  PlusIcon,
  SendHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAppState } from "@/components/app-state-provider";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch, apiJson } from "@/lib/api";
import type { ProviderCredentialSummary, ProviderModel, UiProvider } from "@/lib/contracts";
import { providerHasRequiredCredentials } from "@/lib/provider-credentials";

type ColumnState = {
  id: string;
  providerId: string;
  modelId: string;
  models: ProviderModel[];
  loadingModels: boolean;
  streaming: boolean;
  text: string;
  error: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

function makeColumn(id: string): ColumnState {
  return {
    id,
    providerId: "",
    modelId: "",
    models: [],
    loadingModels: false,
    streaming: false,
    text: "",
    error: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  };
}

async function streamColumn(
  provider: UiProvider,
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void,
): Promise<void> {
  const response = await apiFetch(`${provider.base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, modelId }),
    signal,
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const j = (await response.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("0:")) {
        try { onDelta(JSON.parse(t.slice(2)) as string); } catch { /* ignore */ }
      } else if (t.startsWith("d:")) {
        try {
          const payload = JSON.parse(t.slice(2)) as {
            usage?: { promptTokens?: number; completionTokens?: number };
          };
          if (payload.usage) {
            onUsage({
              inputTokens: payload.usage.promptTokens ?? 0,
              outputTokens: payload.usage.completionTokens ?? 0,
            });
          }
        } catch { /* ignore */ }
      }
    }
  }
}

function ColumnCard({
  col,
  onProviderChange,
  onModelChange,
  onRemove,
  canRemove,
  providers,
  credentials,
}: {
  col: ColumnState;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  providers: UiProvider[];
  credentials: ProviderCredentialSummary[];
}) {
  const readyProviders = providers.filter((p) => p.hasModels && providerHasRequiredCredentials(p, credentials));

  return (
    <Card className="flex min-w-0 flex-1 flex-col border-border/60">
      <CardHeader className="flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Select value={col.providerId} onValueChange={onProviderChange}>
            <SelectTrigger className="flex-1 text-xs">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {readyProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {canRemove && (
            <Button variant="ghost" size="icon-sm" onClick={onRemove} className="shrink-0">
              <Trash2Icon className="size-3.5" />
            </Button>
          )}
        </div>
        <Select
          value={col.modelId}
          onValueChange={onModelChange}
          disabled={!col.providerId || col.loadingModels || col.models.length === 0}
        >
          <SelectTrigger className="text-xs">
            <SelectValue placeholder={col.loadingModels ? "Carregando…" : "Modelo"} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {col.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {(col.durationMs != null || col.inputTokens != null) && (
          <div className="flex flex-wrap gap-1.5">
            {col.durationMs != null && (
              <Badge variant="outline" className="text-[10px]">
                {col.durationMs < 1000 ? `${col.durationMs}ms` : `${(col.durationMs / 1000).toFixed(1)}s`}
              </Badge>
            )}
            {col.inputTokens != null && (
              <Badge variant="outline" className="text-[10px]">
                <ZapIcon className="mr-1 size-2.5" />
                {col.inputTokens}↑ {col.outputTokens ?? 0}↓
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-3 pt-0">
        {col.streaming && !col.text && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
        {col.error ? (
          <p className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{col.error}</p>
        ) : col.text ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
            <MarkdownRenderer content={col.text} />
          </div>
        ) : !col.streaming ? (
          <p className="text-xs text-muted-foreground">A resposta aparecerá aqui.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

let colCounter = 0;
function nextId() {
  colCounter += 1;
  return String(colCounter);
}

export function PlaygroundPage() {
  const { providers, credentials } = useAppState();
  const [prompt, setPrompt] = useState("");
  const [columns, setColumns] = useState<ColumnState[]>([makeColumn(nextId()), makeColumn(nextId())]);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const isRunning = columns.some((c) => c.streaming);

  function setCol(id: string, patch: Partial<ColumnState>) {
    setColumns((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }

  function loadModels(colId: string, provider: UiProvider) {
    if (!provider.hasModels) {
      setCol(colId, { models: [], modelId: "" });
      return;
    }
    if (provider.localModels?.length) {
      setCol(colId, { models: provider.localModels, modelId: provider.localModels[0]?.id ?? "" });
      return;
    }
    setCol(colId, { loadingModels: true, models: [], modelId: "" });
    apiJson<{ models: ProviderModel[] }>(`${provider.base}/api/models`)
      .then((p) => {
        setCol(colId, { models: p.models ?? [], modelId: p.models[0]?.id ?? "", loadingModels: false });
      })
      .catch(() => {
        setCol(colId, { models: [], modelId: "", loadingModels: false });
      });
  }

  function handleProviderChange(colId: string, providerId: string) {
    const provider = providers.find((p) => p.id === providerId);
    setCol(colId, { providerId, modelId: "", models: [], error: null });
    if (provider) loadModels(colId, provider);
  }

  function handleModelChange(colId: string, modelId: string) {
    setCol(colId, { modelId });
  }

  function addColumn() {
    if (columns.length >= 4) return;
    setColumns((prev) => [...prev, makeColumn(nextId())]);
  }

  function removeColumn(colId: string) {
    const controller = abortControllersRef.current.get(colId);
    controller?.abort();
    abortControllersRef.current.delete(colId);
    setColumns((prev) => prev.filter((c) => c.id !== colId));
  }

  function handleStop() {
    abortControllersRef.current.forEach((ctrl) => ctrl.abort());
    abortControllersRef.current.clear();
    setColumns((prev) => prev.map((c) => c.streaming ? { ...c, streaming: false } : c));
  }

  async function handleRun() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("Informe um prompt antes de comparar.");
      return;
    }

    const readyCols = columns.filter((c) => c.providerId && c.modelId);
    if (readyCols.length === 0) {
      toast.error("Configure ao menos um provider e modelo.");
      return;
    }

    setColumns((prev) =>
      prev.map((c) =>
        c.providerId && c.modelId
          ? { ...c, streaming: true, text: "", error: null, durationMs: null, inputTokens: null, outputTokens: null }
          : c,
      ),
    );

    const messages = [{ role: "user", content: trimmed }];

    await Promise.allSettled(
      readyCols.map(async (col) => {
        const provider = providers.find((p) => p.id === col.providerId);
        if (!provider) return;

        const controller = new AbortController();
        abortControllersRef.current.set(col.id, controller);
        const start = Date.now();

        try {
          await streamColumn(
            provider,
            col.modelId,
            messages,
            controller.signal,
            (delta) => {
              setColumns((prev) => prev.map((c) => c.id === col.id ? { ...c, text: c.text + delta } : c));
            },
            (usage) => {
              setCol(col.id, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
            },
          );
          setCol(col.id, { streaming: false, durationMs: Date.now() - start });
        } catch (e) {
          if ((e as Error).name === "AbortError") {
            setCol(col.id, { streaming: false });
          } else {
            setCol(col.id, { streaming: false, error: (e as Error).message ?? "Erro desconhecido." });
          }
        } finally {
          abortControllersRef.current.delete(col.id);
        }
      }),
    );
  }

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((ctrl) => ctrl.abort());
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Playground de comparação</h1>
        <p className="text-sm text-muted-foreground">
          Envie o mesmo prompt para múltiplos modelos em paralelo e compare respostas, latência e custo.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
        <textarea
          className="min-h-[100px] w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          placeholder="Digite seu prompt aqui…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isRunning) {
              void handleRun();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={addColumn}
            disabled={columns.length >= 4}
          >
            <PlusIcon className="mr-1.5 size-3.5" />
            Adicionar coluna
          </Button>
          <div className="flex gap-2">
            {isRunning ? (
              <Button variant="secondary" size="sm" onClick={handleStop}>
                <SquareIcon className="mr-1.5 size-3.5" />
                Parar
              </Button>
            ) : (
              <Button size="sm" onClick={() => void handleRun()}>
                <SendHorizontalIcon className="mr-1.5 size-3.5" />
                Comparar
                <span className="ml-1.5 hidden text-[10px] opacity-60 sm:inline">⌘↵</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-[400px] gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.id} className="min-w-[280px] flex-1">
            <ColumnCard
              col={col}
              onProviderChange={(pId) => handleProviderChange(col.id, pId)}
              onModelChange={(mId) => handleModelChange(col.id, mId)}
              onRemove={() => removeColumn(col.id)}
              canRemove={columns.length > 1}
              providers={providers}
              credentials={credentials}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
