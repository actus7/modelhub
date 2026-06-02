"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  CircleIcon,
  ClipboardCheckIcon,
  ClipboardIcon,
  CloudIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  KeyRoundIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerIcon,
  Settings2Icon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { CloudConnectionSummary, CloudDeploymentStatus, CloudDeploymentSummary, UiProvider } from "@/lib/contracts";
import { apiJson, apiJsonRequest } from "@/lib/api";
import { useAppState } from "@/components/app-state-provider";
import { providerHasRequiredCredentials, providerUsesStoredCredentials } from "@/lib/provider-credentials";

const RENDER_TOKEN_URL = "https://dashboard.render.com/u/settings#api-keys";

// ── Types ────────────────────────────────────────────────────────────────────

type ProviderEntry = Readonly<{ provider: UiProvider; isConfigured: boolean; needsCredentials: boolean }>;
type CloudRefreshResponse = Readonly<{ deleted: boolean; deployment: CloudDeploymentSummary | null }>;
type TokenDialogState = Readonly<{ deploymentId: string; token: string | null; loading: boolean }>;
type ModelItem = Readonly<{ id: string; name: string }>;
type OpenClawConfigPayload = Readonly<{ allowedOrigins: string[]; model: string; provider: string }>;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: typeof value === "string" && value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

function statusLabel(status: CloudDeploymentStatus) {
  const labels: Record<CloudDeploymentStatus, string> = {
    deleting: "Removendo", failed: "Falhou", healthy: "Pronto", provisioning: "Provisionando",
  };
  return labels[status] ?? "Provisionando";
}

function statusVariant(status: CloudDeploymentStatus) {
  if (status === "failed") return "destructive" as const;
  if (status === "healthy") return "outline" as const;
  return "secondary" as const;
}

function renderDashboardUrl(serviceId: string) {
  return `https://dashboard.render.com/web/${serviceId}`;
}

function compareProviderEntries(a: ProviderEntry, b: ProviderEntry): number {
  if (a.isConfigured === b.isConfigured) return 0;
  return a.isConfigured ? -1 : 1;
}

function splitOrigins(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success("Copiado.");
}

function InfoRow({ label, value, href }: Readonly<{ label: string; value: string; href?: string }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {href ? (
          <a className="min-w-0 truncate text-sm underline-offset-4 hover:underline" href={href} target="_blank" rel="noopener noreferrer">
            {value}
          </a>
        ) : (
          <span className="min-w-0 truncate text-sm">{value}</span>
        )}
        <Button size="icon" variant="ghost" onClick={() => void copyText(value)} aria-label={`Copiar ${label}`}>
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
}

// ── Async IO (outside component to reduce cognitive complexity) ──────────────

async function fetchCloudData() {
  const [cp, dp] = await Promise.all([
    apiJson<{ connections: CloudConnectionSummary[] }>("/user/cloud/connections"),
    apiJson<{ deployments: CloudDeploymentSummary[] }>("/user/cloud/deployments"),
  ]);
  return { connections: cp.connections, deployments: dp.deployments };
}

async function fetchModelsForProvider(providerId: string): Promise<ModelItem[]> {
  const res = await apiJson<{ data: Array<{ id: string; owned_by: string }> }>("/v1/models");
  return (res.data ?? [])
    .filter((m) => m.owned_by === providerId)
    .map((m) => ({ id: m.id, name: m.id.includes("/") ? m.id.split("/").slice(1).join("/") : m.id }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DeployForm({
  usableProviders, selectedProvider, selectedModel, availableModels,
  loadingModels, deployBusy, onProviderChange, onModelChange, onDeploy, onConfigureCredentials,
}: Readonly<{
  usableProviders: ProviderEntry[];
  selectedProvider: string;
  selectedModel: string;
  availableModels: ModelItem[];
  loadingModels: boolean;
  deployBusy: boolean;
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onDeploy: () => void;
  onConfigureCredentials: () => void;
}>) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Provider</FieldLabel>
        <Select value={selectedProvider} onValueChange={onProviderChange}>
          <SelectTrigger><SelectValue placeholder="Selecione um provider..." /></SelectTrigger>
          <SelectContent>
            {usableProviders.map(({ provider, isConfigured, needsCredentials }) => (
              <SelectItem key={provider.id} value={provider.id}>
                <span className="flex items-center gap-2">
                  {isConfigured
                    ? <span className="size-2 shrink-0 rounded-full bg-green-500" />
                    : <CircleIcon className="size-2 shrink-0 text-muted-foreground" />}
                  {provider.label}
                  {!isConfigured && needsCredentials
                    ? <span className="text-xs text-muted-foreground">(sem credencial)</span>
                    : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Providers em verde estao configurados e prontos.{" "}
          <button type="button" className="underline" onClick={onConfigureCredentials}>Configurar credenciais</button>
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Modelo</FieldLabel>
        <Select value={selectedModel} onValueChange={onModelChange} disabled={!selectedProvider || loadingModels}>
          <SelectTrigger>
            <SelectValue placeholder={loadingModels ? "Carregando..." : "Selecione um modelo..."} />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <FieldDescription>Modelo padrao que o OpenClaw usara para responder.</FieldDescription>
      </Field>
      <Button disabled={deployBusy || !selectedProvider || !selectedModel} onClick={onDeploy} className="self-start">
        {deployBusy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
        Deploy OpenClaw
      </Button>
    </FieldGroup>
  );
}

function OpenClawConfigPanel({
  deployment, usableProviders, saving, onConfigureCredentials, onSave,
}: Readonly<{
  deployment: CloudDeploymentSummary;
  usableProviders: ProviderEntry[];
  saving: boolean;
  onConfigureCredentials: () => void;
  onSave: (deploymentId: string, payload: OpenClawConfigPayload) => void;
}>) {
  const openclaw = deployment.openclaw;
  const [provider, setProvider] = useState(openclaw?.provider ?? "");
  const [model, setModel] = useState(openclaw?.model ?? "");
  const [originsText, setOriginsText] = useState(openclaw?.allowedOrigins.join("\n") ?? "");
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setProvider(openclaw?.provider ?? "");
    setModel(openclaw?.model ?? "");
    setOriginsText(openclaw?.allowedOrigins.join("\n") ?? "");
  }, [openclaw]);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    setLoadingModels(true);
    fetchModelsForProvider(provider)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [provider]);

  if (!openclaw) return null;

  const modelOptions = models.some((item) => item.id === model)
    ? models
    : [{ id: model, name: model }, ...models].filter((item) => item.id);

  function handleProviderChange(providerId: string) {
    const entry = usableProviders.find((item) => item.provider.id === providerId);
    if (!entry?.isConfigured && entry?.needsCredentials) {
      toast.info(`${entry.provider.label} precisa de credenciais.`);
      onConfigureCredentials();
      return;
    }
    setProvider(providerId);
    setModel("");
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Settings2Icon className="text-muted-foreground" />
          <p className="text-sm font-medium">OpenClaw</p>
        </div>
        <Badge variant="outline">{openclaw.provider}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <InfoRow label="Control UI" value={openclaw.controlUiUrl} href={openclaw.controlUiUrl} />
        <InfoRow label="WebSocket" value={openclaw.webSocketUrl} />
        <InfoRow label="Health" value={openclaw.healthUrl} href={openclaw.healthUrl} />
        <InfoRow label="Ready" value={openclaw.readyUrl} href={openclaw.readyUrl} />
        <InfoRow label="ModelHub API" value={openclaw.modelhubApiUrl} />
        <InfoRow label="Modelo ativo" value={openclaw.model} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Origins permitidas</span>
        <div className="flex flex-wrap gap-2">
          {openclaw.allowedOrigins.map((origin) => (
            <Badge key={origin} variant="secondary" className="max-w-full truncate">
              <GlobeIcon />{origin}
            </Badge>
          ))}
        </div>
      </div>

      <Separator />

      <FieldGroup>
        <Field>
          <FieldLabel>Provider do agente</FieldLabel>
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger><SelectValue placeholder="Selecione um provider..." /></SelectTrigger>
            <SelectContent>
              {usableProviders.map(({ provider: item, isConfigured, needsCredentials }) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}{!isConfigured && needsCredentials ? " (sem credencial)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Modelo do agente</FieldLabel>
          <Select value={model} onValueChange={setModel} disabled={!provider || loadingModels}>
            <SelectTrigger>
              <SelectValue placeholder={loadingModels ? "Carregando..." : "Selecione um modelo..."} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Origins do Control UI</FieldLabel>
          <Textarea
            value={originsText}
            onChange={(event) => setOriginsText(event.target.value)}
            placeholder="https://modelhub-openclaw-xxxx.onrender.com"
            rows={3}
          />
          <FieldDescription>Use uma origem por linha. Inclua a URL publica do OpenClaw e a origem do ModelHub.</FieldDescription>
        </Field>
        <Button
          className="self-start"
          disabled={saving || !provider || !model}
          onClick={() => onSave(deployment.id, { allowedOrigins: splitOrigins(originsText), model, provider })}
        >
          {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          Aplicar configuracao
        </Button>
      </FieldGroup>
    </div>
  );
}

function DeploymentCard({
  deployment, busyAction, usableProviders, onConfigureCredentials, onRevealToken, onRefresh, onDelete, onUpdateOpenClaw, onChat,
}: Readonly<{
  deployment: CloudDeploymentSummary;
  busyAction: string | null;
  usableProviders: ProviderEntry[];
  onConfigureCredentials: () => void;
  onRevealToken: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUpdateOpenClaw: (deploymentId: string, payload: OpenClawConfigPayload) => void;
  onChat: (deploymentId: string) => void;
}>) {
  const isDeleting = deployment.status === "deleting";
  const isReady = deployment.status === "healthy";
  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{deployment.name}</p>
              <Badge variant={statusVariant(deployment.status)}>{statusLabel(deployment.status)}</Badge>
            </div>
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span>{deployment.image}</span>
              <span>{deployment.region} / {deployment.instanceType} / porta {deployment.port}</span>
              <span>ID: {deployment.externalServiceId}</span>
              <span>Criado em {formatDate(deployment.createdAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {deployment.publicUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={deployment.publicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />Abrir
                </a>
              </Button>
            ) : null}
            {isReady ? (
              <Button size="sm" variant="default" onClick={() => onChat(deployment.id)}>
                <MessageSquareTextIcon data-icon="inline-start" />Conversar
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <a href={renderDashboardUrl(deployment.externalServiceId)} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon data-icon="inline-start" />Dashboard
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={onRevealToken}>
              <KeyRoundIcon data-icon="inline-start" />Token
            </Button>
            <Button disabled={busyAction === `refresh:${deployment.id}` || isDeleting} onClick={onRefresh} size="sm" variant="ghost">
              {busyAction === `refresh:${deployment.id}`
                ? <Loader2Icon className="animate-spin" data-icon="inline-start" />
                : <RefreshCwIcon data-icon="inline-start" />}
              Atualizar
            </Button>
            <Button disabled={busyAction === `delete:${deployment.id}` || isDeleting} onClick={onDelete} size="sm" variant="ghost">
              {busyAction === `delete:${deployment.id}`
                ? <Loader2Icon className="animate-spin" data-icon="inline-start" />
                : <Trash2Icon data-icon="inline-start" />}
              Remover
            </Button>
          </div>
        </div>
        {deployment.error ? (
          <Alert variant="destructive">
            <AlertTitle>Erro do ambiente</AlertTitle>
            <AlertDescription>{deployment.error}</AlertDescription>
          </Alert>
        ) : null}
        <OpenClawConfigPanel
          deployment={deployment}
          usableProviders={usableProviders}
          saving={busyAction === `openclaw-config:${deployment.id}`}
          onConfigureCredentials={onConfigureCredentials}
          onSave={onUpdateOpenClaw}
        />
      </CardContent>
    </Card>
  );
}

function TokenDialog({
  state, copied, onCopy, onClose,
}: Readonly<{
  state: TokenDialogState | null;
  copied: boolean;
  onCopy: (value: string) => void;
  onClose: () => void;
}>) {
  return (
    <AlertDialog open={!!state} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" />Gateway Token
          </AlertDialogTitle>
          <AlertDialogDescription>
            Bearer token para autenticar requisicoes ao OpenClaw. Guarde em local seguro.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1">
          {state?.loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />Carregando...
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded bg-muted p-3 text-xs leading-relaxed">
                {state?.token ?? ""}
              </code>
              <Button
                size="sm" variant="outline" className="shrink-0"
                onClick={() => state?.token ? onCopy(state.token) : undefined}
              >
                {copied
                  ? <ClipboardCheckIcon className="size-4 text-green-500" />
                  : <ClipboardIcon className="size-4" />}
              </Button>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Fechar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CloudDashboardSection() {
  const router = useRouter();
  const { credentials, providers } = useAppState();

  const [connections, setConnections] = useState<CloudConnectionSummary[]>([]);
  const [deployments, setDeployments] = useState<CloudDeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [revealedGatewayToken, setRevealedGatewayToken] = useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CloudDeploymentSummary | null>(null);

  const usableProviders = useMemo<ProviderEntry[]>(
    () => providers
      .filter((p) => p.hasModels && p.runtime?.kind === "server")
      .map((p) => ({
        isConfigured: providerHasRequiredCredentials(p, credentials),
        needsCredentials: providerUsesStoredCredentials(p),
        provider: p,
      }))
      .sort(compareProviderEntries),
    [providers, credentials],
  );

  const renderConnection = useMemo(
    () => connections.find((c) => c.provider === "render") ?? null,
    [connections],
  );

  // Stable string key so the polling effect only re-subscribes when the set of
  // polled ids actually changes (not on every deployments array reference change).
  const pollingIdsStr = useMemo(
    () =>
      deployments
        .filter((d) => d.status === "provisioning" || d.status === "deleting")
        .map((d) => d.id)
        .join(","),
    [deployments],
  );

  const loadCloud = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchCloudData();
      setConnections(data.connections);
      setDeployments(data.deployments);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Falha ao carregar OpenClaw.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshDeployment = useCallback(async (deploymentId: string, silent = false) => {
    if (!silent) setBusyAction(`refresh:${deploymentId}`);
    try {
      const payload = await apiJsonRequest<CloudRefreshResponse>(`/user/cloud/deployments/${deploymentId}/refresh`, "POST");
      if (payload.deleted) {
        setDeployments((curr) => curr.filter((d) => d.id !== deploymentId));
        if (!silent) toast.info("O ambiente ja foi removido no Render.");
        return;
      }
      if (payload.deployment) {
        setDeployments((curr) => curr.map((d) => (d.id === deploymentId ? payload.deployment! : d)));
      }
      if (!silent) toast.success("Status atualizado.");
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Falha ao atualizar status.");
      await loadCloud(true);
    } finally {
      if (!silent) setBusyAction(null);
    }
  }, [loadCloud]);

  useEffect(() => { void loadCloud(); }, [loadCloud]);

  useEffect(() => {
    const ids = pollingIdsStr.split(",").filter(Boolean);
    if (ids.length === 0) return;
    const interval = globalThis.setInterval(() => {
      for (const id of ids) void refreshDeployment(id, true);
    }, 10_000);
    return () => globalThis.clearInterval(interval);
  }, [pollingIdsStr, refreshDeployment]);

  useEffect(() => {
    if (!selectedProvider) { setAvailableModels([]); setSelectedModel(""); return; }
    setLoadingModels(true);
    setAvailableModels([]);
    setSelectedModel("");
    fetchModelsForProvider(selectedProvider)
      .then(setAvailableModels)
      .catch(() => setAvailableModels([]))
      .finally(() => setLoadingModels(false));
  }, [selectedProvider]);

  function handleProviderChange(providerId: string) {
    const entry = usableProviders.find((e) => e.provider.id === providerId);
    if (!entry?.isConfigured && entry?.needsCredentials) {
      toast.info(`${entry.provider.label} precisa de credenciais.`, {
        action: { label: "Configurar", onClick: () => router.push("/dashboard/credentials") },
      });
      return;
    }
    setSelectedProvider(providerId);
  }

  async function handleConnect() {
    if (!token.trim()) { toast.error("Cole o token do Render antes de conectar."); return; }
    setBusyAction("connect");
    try {
      const { connection } = await apiJsonRequest<{ connection: CloudConnectionSummary }>("/user/cloud/connections/render", "POST", { token });
      setConnections((curr) => [connection, ...curr.filter((c) => c.id !== connection.id)]);
      setToken("");
      toast.success("Render conectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao conectar Render.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisconnect() {
    if (!renderConnection) return;
    setBusyAction("disconnect");
    try {
      await apiJsonRequest(`/user/cloud/connections/${renderConnection.id}`, "DELETE");
      setConnections((curr) => curr.filter((c) => c.id !== renderConnection.id));
      toast.success("Render desconectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desconectar Render.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeployOpenClaw() {
    if (!selectedProvider || !selectedModel) { toast.error("Selecione o provider e o modelo."); return; }
    setBusyAction("deploy-openclaw");
    try {
      const { deployment, gatewayToken } = await apiJsonRequest<{ deployment: CloudDeploymentSummary; gatewayToken: string }>(
        "/user/cloud/deployments/render/openclaw", "POST", { model: selectedModel, provider: selectedProvider },
      );
      setDeployments((curr) => [deployment, ...curr]);
      setRevealedGatewayToken(gatewayToken);
      toast.success("OpenClaw criado no Render.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar OpenClaw.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeploy() {
    setBusyAction("deploy");
    try {
      const { deployment } = await apiJsonRequest<{ deployment: CloudDeploymentSummary }>("/user/cloud/deployments/render", "POST");
      setDeployments((curr) => [deployment, ...curr]);
      toast.success("Ambiente de teste criado no Render.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar ambiente.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteDeployment(deployment: CloudDeploymentSummary) {
    setPendingDelete(null);
    setBusyAction(`delete:${deployment.id}`);
    setDeployments((curr) => curr.map((d) => (d.id === deployment.id ? { ...d, status: "deleting" } : d)));
    try {
      await apiJsonRequest(`/user/cloud/deployments/${deployment.id}`, "DELETE");
      setDeployments((curr) => curr.filter((d) => d.id !== deployment.id));
      toast.success("Ambiente removido.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover ambiente.");
      await loadCloud(true);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpdateOpenClaw(deploymentId: string, payload: OpenClawConfigPayload) {
    setBusyAction(`openclaw-config:${deploymentId}`);
    try {
      const { deployment } = await apiJsonRequest<{ deployment: CloudDeploymentSummary }>(
        `/user/cloud/deployments/${deploymentId}/openclaw`,
        "PATCH",
        payload,
      );
      setDeployments((curr) => curr.map((item) => (item.id === deploymentId ? deployment : item)));
      toast.success("Configuracao OpenClaw aplicada. O Render esta redeployando.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar OpenClaw.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevealToken(deploymentId: string) {
    setTokenDialog({ deploymentId, loading: true, token: null });
    setCopied(false);
    try {
      const { gatewayToken } = await apiJson<{ gatewayToken: string }>(`/user/cloud/deployments/${deploymentId}/gateway-token`);
      setTokenDialog({ deploymentId, loading: false, token: gatewayToken });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar token.");
      setTokenDialog(null);
    }
  }

  async function handleCopyToken(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />Carregando OpenClaw...
        </CardContent>
      </Card>
    );
  }

  const canDeploy = deployments.length === 0;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2"><CloudIcon />OpenClaw</CardTitle>
                <CardDescription>Conecte sua conta Render e provisione o OpenClaw com um click.</CardDescription>
              </div>
              {renderConnection
                ? <Badge variant="outline" className="gap-1.5"><CheckCircle2Icon />Conectado</Badge>
                : <Badge variant="secondary">Desconectado</Badge>}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {renderConnection ? (
              <>
                <div className="rounded-lg border border-border/60 p-3 text-sm">
                  <p className="font-medium">{renderConnection.label}</p>
                  <p className="text-muted-foreground">
                    {renderConnection.externalOrganizationName ?? "Workspace Render"}
                    {renderConnection.externalUserEmail ? ` (${renderConnection.externalUserEmail})` : null}
                  </p>
                  <p className="text-xs text-muted-foreground">Atualizado em {formatDate(renderConnection.updatedAt)}</p>
                </div>
                {revealedGatewayToken ? (
                  <Alert>
                    <AlertTitle>Gateway Token do OpenClaw (salve agora)</AlertTitle>
                    <AlertDescription>
                      <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">{revealedGatewayToken}</code>
                      <p className="mt-2 text-xs">Use o botao Token no card do ambiente para recuperar a qualquer momento.</p>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {canDeploy ? (
                  <DeployForm
                    usableProviders={usableProviders}
                    selectedProvider={selectedProvider}
                    selectedModel={selectedModel}
                    availableModels={availableModels}
                    loadingModels={loadingModels}
                    deployBusy={busyAction === "deploy-openclaw"}
                    onProviderChange={handleProviderChange}
                    onModelChange={setSelectedModel}
                    onDeploy={() => void handleDeployOpenClaw()}
                    onConfigureCredentials={() => router.push("/dashboard/credentials")}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busyAction === "deploy" || !canDeploy} onClick={() => void handleDeploy()} size="sm" variant="outline">
                    {busyAction === "deploy" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ServerIcon data-icon="inline-start" />}
                    Ambiente de teste
                  </Button>
                  <Button asChild variant="outline">
                    <a href="https://dashboard.render.com" target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon data-icon="inline-start" />Abrir Render
                    </a>
                  </Button>
                  <Button disabled={busyAction === "disconnect" || deployments.length > 0} onClick={() => void handleDisconnect()} variant="ghost">
                    {busyAction === "disconnect" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <UnplugIcon data-icon="inline-start" />}
                    Desconectar
                  </Button>
                </div>
                {deployments.length > 0
                  ? <p className="text-xs text-muted-foreground">Remova os ambientes antes de desconectar o Render.</p>
                  : null}
              </>
            ) : (
              <>
                <Alert>
                  <CloudIcon />
                  <AlertTitle>API Key do Render</AlertTitle>
                  <AlertDescription>Acesse Account Settings no Render, gere uma API Key, cole aqui. Nenhum cartao de credito necessario.</AlertDescription>
                </Alert>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="render-token">API Key Render</FieldLabel>
                    <Input id="render-token" type="password" autoComplete="off" placeholder="Cole a API Key do Render" value={token} onChange={(e) => setToken(e.target.value)} />
                    <FieldDescription>A API key e salva criptografada e nunca exibida novamente.</FieldDescription>
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busyAction === "connect"} onClick={() => void handleConnect()}>
                    {busyAction === "connect" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
                    Conectar Render
                  </Button>
                  <Button asChild variant="outline">
                    <a href={RENDER_TOKEN_URL} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon data-icon="inline-start" />Criar API Key
                    </a>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>Seus ambientes</CardTitle>
                <CardDescription>Agentes OpenClaw provisionados na sua conta Render. Ambientes gratuitos podem levar ate 1 minuto para acordar.</CardDescription>
              </div>
              <Badge variant="secondary">{deployments.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {deployments.length === 0 ? (
              <Empty className="border-border/60">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><ServerIcon /></EmptyMedia>
                  <EmptyTitle>Nenhum ambiente criado</EmptyTitle>
                  <EmptyDescription>Selecione um provider, escolha o modelo e clique em Deploy OpenClaw para criar seu agente.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {deployments.map((deployment) => (
                  <DeploymentCard
                    key={deployment.id}
                    deployment={deployment}
                    busyAction={busyAction}
                    usableProviders={usableProviders}
                    onConfigureCredentials={() => router.push("/dashboard/credentials")}
                    onRevealToken={() => void handleRevealToken(deployment.id)}
                    onRefresh={() => void refreshDeployment(deployment.id)}
                    onDelete={() => setPendingDelete(deployment)}
                    onUpdateOpenClaw={(deploymentId, payload) => void handleUpdateOpenClaw(deploymentId, payload)}
                    onChat={(deploymentId) => router.push(`/chat?openclaw=${deploymentId}`)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover ambiente OpenClaw?</AlertDialogTitle>
            <AlertDialogDescription>O servico sera removido da sua conta Render. Esta acao e irreversivel e interrompe a URL publica do ambiente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pendingDelete ? void handleDeleteDeployment(pendingDelete) : undefined}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TokenDialog
        state={tokenDialog}
        copied={copied}
        onCopy={(value) => void handleCopyToken(value)}
        onClose={() => { setTokenDialog(null); setCopied(false); }}
      />
    </>
  );
}
