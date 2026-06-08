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
import type {
  CloudConnectionSummary,
  CloudDeploymentStatus,
  CloudDeploymentSummary,
  CloudProvider,
  UiProvider,
} from "@/lib/contracts";
import { apiJson, apiJsonRequest } from "@/lib/api";
import { useAppState } from "@/components/app-state-provider";
import { providerHasRequiredCredentials, providerUsesStoredCredentials } from "@/lib/provider-credentials";

// ── Cloud provider metadata ───────────────────────────────────────────────────

const CLOUD_PROVIDERS = [
  {
    id: "render" as CloudProvider,
    label: "Render",
    tokenUrl: "https://dashboard.render.com/u/settings#api-keys",
    placeholder: "rnd_...",
    description: "Free tier com 750h/mês",
  },
  {
    id: "railway" as CloudProvider,
    label: "Railway",
    tokenUrl: "https://railway.app/account/tokens",
    placeholder: "Token Railway...",
    description: "$5 de crédito/mês grátis",
  },
  {
    id: "fly.io" as CloudProvider,
    label: "Fly.io",
    tokenUrl: "https://fly.io/user/personal_access_tokens",
    placeholder: "fo1_...",
    description: "3 VMs grátis, 256MB cada",
  },
] as const;

type CloudProviderMeta = (typeof CLOUD_PROVIDERS)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderEntry = Readonly<{ provider: UiProvider; isConfigured: boolean; needsCredentials: boolean }>;
type CloudRefreshResponse = Readonly<{ deleted: boolean; deployment: CloudDeploymentSummary | null }>;
type TokenDialogState = Readonly<{ deploymentId: string; token: string | null; loading: boolean }>;
type ModelItem = Readonly<{ id: string; name: string }>;
type OpenClawConfigPayload = Readonly<{ allowedOrigins: string[]; model: string; provider: string }>;

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: typeof value === "string" && value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

function statusLabel(status: CloudDeploymentStatus) {
  const labels: Record<CloudDeploymentStatus, string> = {
    deleting: "Removendo",
    failed: "Falhou",
    healthy: "Pronto",
    provisioning: "Provisionando",
  };
  return labels[status] ?? "Provisionando";
}

function statusVariant(status: CloudDeploymentStatus) {
  if (status === "failed") return "destructive" as const;
  if (status === "healthy") return "outline" as const;
  return "secondary" as const;
}

function deploymentDashboardUrl(deployment: CloudDeploymentSummary): string | null {
  const sid = deployment.externalServiceId;
  if (deployment.provider === "render") return `https://dashboard.render.com/web/${sid}`;
  if (deployment.provider === "railway") {
    const projectId = sid.split(":")[1];
    return projectId ? `https://railway.app/project/${projectId}` : null;
  }
  if (deployment.provider === "fly.io") {
    const appName = sid.split("/")[0];
    return appName ? `https://fly.io/apps/${appName}` : null;
  }
  return null;
}

function cloudProviderLabel(provider: CloudProvider): string {
  return CLOUD_PROVIDERS.find((cp) => cp.id === provider)?.label ?? provider;
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
          <a
            className="min-w-0 truncate text-sm underline-offset-4 hover:underline"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
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

// ── Async IO ──────────────────────────────────────────────────────────────────

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

// ── CloudProviderRow ──────────────────────────────────────────────────────────

function CloudProviderRow({
  meta,
  connection,
  isConnecting,
  token,
  busyAction,
  hasDeployments,
  onStartConnect,
  onCancelConnect,
  onTokenChange,
  onConnect,
  onDisconnect,
}: Readonly<{
  meta: CloudProviderMeta;
  connection: CloudConnectionSummary | undefined;
  isConnecting: boolean;
  token: string;
  busyAction: string | null;
  hasDeployments: boolean;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  onTokenChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: (conn: CloudConnectionSummary) => void;
}>) {
  const connectBusy = busyAction === `connect:${meta.id}`;
  const disconnectBusy = connection && busyAction === `disconnect:${connection.id}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{meta.label}</span>
            {connection ? (
              <Badge variant="outline" className="gap-1 text-xs">
                <CheckCircle2Icon className="size-3" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Desconectado
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connection
              ? (connection.externalOrganizationName ?? connection.externalUserEmail ?? meta.description)
              : meta.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connection ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!disconnectBusy || hasDeployments}
              title={hasDeployments ? "Remova os ambientes antes de desconectar" : undefined}
              onClick={() => onDisconnect(connection)}
            >
              {disconnectBusy ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <UnplugIcon data-icon="inline-start" />
              )}
              Desconectar
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onStartConnect}>
              <PlugZapIcon data-icon="inline-start" />
              Conectar
            </Button>
          )}
        </div>
      </div>

      {isConnecting && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">API Token do {meta.label}</span>
            <Button size="sm" variant="ghost" onClick={onCancelConnect}>
              Cancelar
            </Button>
          </div>
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            placeholder={meta.placeholder}
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConnect();
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={connectBusy || !token.trim()} onClick={onConnect}>
              {connectBusy ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <PlugZapIcon data-icon="inline-start" />
              )}
              Conectar
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={meta.tokenUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon data-icon="inline-start" />
                Gerar token
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DeployForm ────────────────────────────────────────────────────────────────

function DeployForm({
  connectedCloudProviders,
  selectedCloudProvider,
  usableProviders,
  selectedProvider,
  selectedModel,
  availableModels,
  loadingModels,
  deployBusy,
  onCloudProviderChange,
  onProviderChange,
  onModelChange,
  onDeploy,
  onConfigureCredentials,
}: Readonly<{
  connectedCloudProviders: CloudProviderMeta[];
  selectedCloudProvider: string;
  usableProviders: ProviderEntry[];
  selectedProvider: string;
  selectedModel: string;
  availableModels: ModelItem[];
  loadingModels: boolean;
  deployBusy: boolean;
  onCloudProviderChange: (id: string) => void;
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onDeploy: () => void;
  onConfigureCredentials: () => void;
}>) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Onde hospedar</FieldLabel>
        <Select value={selectedCloudProvider} onValueChange={onCloudProviderChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o provedor cloud..." />
          </SelectTrigger>
          <SelectContent>
            {connectedCloudProviders.map((cp) => (
              <SelectItem key={cp.id} value={cp.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-green-500" />
                  {cp.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Provedor cloud onde o OpenClaw será hospedado.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Provider do agente</FieldLabel>
        <Select value={selectedProvider} onValueChange={onProviderChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um provider de IA..." />
          </SelectTrigger>
          <SelectContent>
            {usableProviders.map(({ provider, isConfigured, needsCredentials }) => (
              <SelectItem key={provider.id} value={provider.id}>
                <span className="flex items-center gap-2">
                  {isConfigured ? (
                    <span className="size-2 shrink-0 rounded-full bg-green-500" />
                  ) : (
                    <CircleIcon className="size-2 shrink-0 text-muted-foreground" />
                  )}
                  {provider.label}
                  {!isConfigured && needsCredentials ? (
                    <span className="text-xs text-muted-foreground">(sem credencial)</span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Provider de IA que o agente usará.{" "}
          <button type="button" className="underline" onClick={onConfigureCredentials}>
            Configurar credenciais
          </button>
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Modelo</FieldLabel>
        <Select value={selectedModel} onValueChange={onModelChange} disabled={!selectedProvider || loadingModels}>
          <SelectTrigger>
            <SelectValue placeholder={loadingModels ? "Carregando..." : "Selecione um modelo..."} />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Modelo que o OpenClaw usará por padrão.</FieldDescription>
      </Field>
      <Button
        disabled={deployBusy || !selectedCloudProvider || !selectedProvider || !selectedModel}
        onClick={onDeploy}
        className="self-start"
      >
        {deployBusy ? (
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
        ) : (
          <PlugZapIcon data-icon="inline-start" />
        )}
        Deploy OpenClaw
      </Button>
    </FieldGroup>
  );
}

// ── OpenClawConfigPanel ───────────────────────────────────────────────────────

function OpenClawConfigPanel({
  deployment,
  usableProviders,
  saving,
  onConfigureCredentials,
  onSave,
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
    if (!provider) {
      setModels([]);
      return;
    }
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
              <GlobeIcon />
              {origin}
            </Badge>
          ))}
        </div>
      </div>

      <Separator />

      <FieldGroup>
        <Field>
          <FieldLabel>Provider do agente</FieldLabel>
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um provider..." />
            </SelectTrigger>
            <SelectContent>
              {usableProviders.map(({ provider: item, isConfigured, needsCredentials }) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                  {!isConfigured && needsCredentials ? " (sem credencial)" : ""}
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
              {modelOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
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
          <FieldDescription>
            Uma origem por linha. Inclua a URL pública do OpenClaw e a origem do ModelHub.
          </FieldDescription>
        </Field>
        <Button
          className="self-start"
          disabled={saving || !provider || !model}
          onClick={() =>
            onSave(deployment.id, { allowedOrigins: splitOrigins(originsText), model, provider })
          }
        >
          {saving ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <SaveIcon data-icon="inline-start" />
          )}
          Aplicar configuração
        </Button>
      </FieldGroup>
    </div>
  );
}

// ── DeploymentCard ────────────────────────────────────────────────────────────

function DeploymentCard({
  deployment,
  busyAction,
  usableProviders,
  onConfigureCredentials,
  onRevealToken,
  onRefresh,
  onDelete,
  onUpdateOpenClaw,
  onChat,
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
  const dashboardUrl = deploymentDashboardUrl(deployment);

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{deployment.name}</p>
              <Badge variant={statusVariant(deployment.status)}>{statusLabel(deployment.status)}</Badge>
              <Badge variant="secondary" className="text-xs">
                {cloudProviderLabel(deployment.provider)}
              </Badge>
            </div>
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span>{deployment.image}</span>
              <span>
                {deployment.region} / {deployment.instanceType} / porta {deployment.port}
              </span>
              <span>ID: {deployment.externalServiceId}</span>
              <span>Criado em {formatDate(deployment.createdAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {deployment.publicUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={deployment.publicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />
                  Abrir
                </a>
              </Button>
            ) : null}
            {isReady ? (
              <Button size="sm" variant="default" onClick={() => onChat(deployment.id)}>
                <MessageSquareTextIcon data-icon="inline-start" />
                Conversar
              </Button>
            ) : null}
            {dashboardUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />
                  Dashboard
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onRevealToken}>
              <KeyRoundIcon data-icon="inline-start" />
              Token
            </Button>
            <Button
              disabled={busyAction === `refresh:${deployment.id}` || isDeleting}
              onClick={onRefresh}
              size="sm"
              variant="ghost"
            >
              {busyAction === `refresh:${deployment.id}` ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Atualizar
            </Button>
            <Button
              disabled={busyAction === `delete:${deployment.id}` || isDeleting}
              onClick={onDelete}
              size="sm"
              variant="ghost"
            >
              {busyAction === `delete:${deployment.id}` ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
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

// ── TokenDialog ───────────────────────────────────────────────────────────────

function TokenDialog({
  state,
  copied,
  onCopy,
  onClose,
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
            <KeyRoundIcon className="size-4" />
            Gateway Token
          </AlertDialogTitle>
          <AlertDialogDescription>
            Bearer token para autenticar requisições ao OpenClaw. Guarde em local seguro.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1">
          {state?.loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Carregando...
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <code className="flex-1 break-all rounded bg-muted p-3 text-xs leading-relaxed">
                {state?.token ?? ""}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => (state?.token ? onCopy(state.token) : undefined)}
              >
                {copied ? (
                  <ClipboardCheckIcon className="size-4 text-green-500" />
                ) : (
                  <ClipboardIcon className="size-4" />
                )}
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

  // connection management
  const [connectingProvider, setConnectingProvider] = useState<CloudProvider | null>(null);
  const [providerToken, setProviderToken] = useState("");

  // deploy form
  const [selectedCloudProvider, setSelectedCloudProvider] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // misc
  const [revealedGatewayToken, setRevealedGatewayToken] = useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CloudDeploymentSummary | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  const cloudConnectionMap = useMemo(
    () =>
      Object.fromEntries(connections.map((c) => [c.provider, c])) as Partial<
        Record<CloudProvider, CloudConnectionSummary>
      >,
    [connections],
  );

  const connectedCloudProviders = useMemo(
    () => CLOUD_PROVIDERS.filter((cp) => !!cloudConnectionMap[cp.id]),
    [cloudConnectionMap],
  );

  const usableProviders = useMemo<ProviderEntry[]>(
    () =>
      providers
        .filter((p) => p.hasModels && p.runtime?.kind === "server")
        .map((p) => ({
          isConfigured: providerHasRequiredCredentials(p, credentials),
          needsCredentials: providerUsesStoredCredentials(p),
          provider: p,
        }))
        .sort(compareProviderEntries),
    [providers, credentials],
  );

  const pollingIdsStr = useMemo(
    () =>
      deployments
        .filter((d) => d.status === "provisioning" || d.status === "deleting")
        .map((d) => d.id)
        .join(","),
    [deployments],
  );

  const canDeploy = deployments.length === 0;

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadCloud = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchCloudData();
      setConnections(data.connections);
      setDeployments(data.deployments);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Falha ao carregar dados cloud.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshDeployment = useCallback(
    async (deploymentId: string, silent = false) => {
      if (!silent) setBusyAction(`refresh:${deploymentId}`);
      try {
        const payload = await apiJsonRequest<CloudRefreshResponse>(
          `/user/cloud/deployments/${deploymentId}/refresh`,
          "POST",
        );
        if (payload.deleted) {
          setDeployments((curr) => curr.filter((d) => d.id !== deploymentId));
          if (!silent) toast.info("O ambiente já foi removido no provedor.");
          return;
        }
        if (payload.deployment) {
          setDeployments((curr) =>
            curr.map((d) => (d.id === deploymentId ? payload.deployment! : d)),
          );
        }
        if (!silent) toast.success("Status atualizado.");
      } catch (error) {
        if (!silent) toast.error(error instanceof Error ? error.message : "Falha ao atualizar status.");
        await loadCloud(true);
      } finally {
        if (!silent) setBusyAction(null);
      }
    },
    [loadCloud],
  );

  useEffect(() => {
    void loadCloud();
  }, [loadCloud]);

  useEffect(() => {
    const ids = pollingIdsStr.split(",").filter(Boolean);
    if (ids.length === 0) return;
    const interval = globalThis.setInterval(() => {
      for (const id of ids) void refreshDeployment(id, true);
    }, 10_000);
    return () => globalThis.clearInterval(interval);
  }, [pollingIdsStr, refreshDeployment]);

  useEffect(() => {
    if (!selectedProvider) {
      setAvailableModels([]);
      setSelectedModel("");
      return;
    }
    setLoadingModels(true);
    setAvailableModels([]);
    setSelectedModel("");
    fetchModelsForProvider(selectedProvider)
      .then(setAvailableModels)
      .catch(() => setAvailableModels([]))
      .finally(() => setLoadingModels(false));
  }, [selectedProvider]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleAiProviderChange(providerId: string) {
    const entry = usableProviders.find((e) => e.provider.id === providerId);
    if (!entry?.isConfigured && entry?.needsCredentials) {
      toast.info(`${entry.provider.label} precisa de credenciais.`, {
        action: { label: "Configurar", onClick: () => router.push("/dashboard/credentials") },
      });
      return;
    }
    setSelectedProvider(providerId);
  }

  async function handleConnect(provider: CloudProvider) {
    if (!providerToken.trim()) {
      toast.error("Cole o token antes de conectar.");
      return;
    }
    setBusyAction(`connect:${provider}`);
    try {
      const endpoint =
        provider === "render"
          ? "/user/cloud/connections/render"
          : `/user/cloud/connections/${provider}`;
      const { connection } = await apiJsonRequest<{ connection: CloudConnectionSummary }>(
        endpoint,
        "POST",
        { token: providerToken },
      );
      setConnections((curr) => [connection, ...curr.filter((c) => c.id !== connection.id)]);
      setConnectingProvider(null);
      setProviderToken("");
      toast.success(`${cloudProviderLabel(provider)} conectado.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Falha ao conectar ${cloudProviderLabel(provider)}.`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisconnect(connection: CloudConnectionSummary) {
    setBusyAction(`disconnect:${connection.id}`);
    try {
      await apiJsonRequest(`/user/cloud/connections/${connection.id}`, "DELETE");
      setConnections((curr) => curr.filter((c) => c.id !== connection.id));
      toast.success(`${cloudProviderLabel(connection.provider)} desconectado.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Falha ao desconectar ${cloudProviderLabel(connection.provider)}.`,
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeployOpenClaw() {
    if (!selectedCloudProvider || !selectedProvider || !selectedModel) {
      toast.error("Selecione o provedor cloud, o provider de IA e o modelo.");
      return;
    }
    setBusyAction("deploy-openclaw");
    try {
      const endpoint =
        selectedCloudProvider === "render"
          ? "/user/cloud/deployments/render/openclaw"
          : `/user/cloud/deployments/${selectedCloudProvider}/openclaw`;
      const { deployment, gatewayToken } = await apiJsonRequest<{
        deployment: CloudDeploymentSummary;
        gatewayToken: string;
      }>(endpoint, "POST", { model: selectedModel, provider: selectedProvider });
      setDeployments((curr) => [deployment, ...curr]);
      setRevealedGatewayToken(gatewayToken);
      toast.success(`OpenClaw criado no ${cloudProviderLabel(selectedCloudProvider as CloudProvider)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar OpenClaw.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteDeployment(deployment: CloudDeploymentSummary) {
    setPendingDelete(null);
    setBusyAction(`delete:${deployment.id}`);
    setDeployments((curr) =>
      curr.map((d) => (d.id === deployment.id ? { ...d, status: "deleting" as const } : d)),
    );
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
      toast.success("Configuração aplicada. O ambiente está redeployando.");
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
      const { gatewayToken } = await apiJson<{ gatewayToken: string }>(
        `/user/cloud/deployments/${deploymentId}/gateway-token`,
      );
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          Carregando OpenClaw...
        </CardContent>
      </Card>
    );
  }

  const anyConnected = connectedCloudProviders.length > 0;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {/* ── Left: connections + deploy form ── */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2">
                  <CloudIcon />
                  OpenClaw
                </CardTitle>
                <CardDescription>
                  Conecte um provedor cloud e provisione o OpenClaw com um clique.
                </CardDescription>
              </div>
              <Badge variant={anyConnected ? "outline" : "secondary"} className={anyConnected ? "gap-1.5" : ""}>
                {anyConnected ? (
                  <>
                    <CheckCircle2Icon />
                    {connectedCloudProviders.length === 1
                      ? connectedCloudProviders[0].label
                      : `${connectedCloudProviders.length} conectados`}
                  </>
                ) : (
                  "Desconectado"
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Cloud provider connections */}
            <div className="flex flex-col gap-2">
              {CLOUD_PROVIDERS.map((meta) => (
                <CloudProviderRow
                  key={meta.id}
                  meta={meta}
                  connection={cloudConnectionMap[meta.id]}
                  isConnecting={connectingProvider === meta.id}
                  token={connectingProvider === meta.id ? providerToken : ""}
                  busyAction={busyAction}
                  hasDeployments={deployments.some((d) => d.provider === meta.id)}
                  onStartConnect={() => {
                    setConnectingProvider(meta.id);
                    setProviderToken("");
                  }}
                  onCancelConnect={() => {
                    setConnectingProvider(null);
                    setProviderToken("");
                  }}
                  onTokenChange={setProviderToken}
                  onConnect={() => void handleConnect(meta.id)}
                  onDisconnect={handleDisconnect}
                />
              ))}
            </div>

            {/* Deploy form — only shown when at least one cloud is connected and no active deployment */}
            {anyConnected && canDeploy ? (
              <>
                <Separator />
                {revealedGatewayToken ? (
                  <Alert>
                    <AlertTitle>Gateway Token do OpenClaw (salve agora)</AlertTitle>
                    <AlertDescription>
                      <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
                        {revealedGatewayToken}
                      </code>
                      <p className="mt-2 text-xs">
                        Use o botão Token no card do ambiente para recuperar a qualquer momento.
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <DeployForm
                  connectedCloudProviders={connectedCloudProviders}
                  selectedCloudProvider={selectedCloudProvider}
                  usableProviders={usableProviders}
                  selectedProvider={selectedProvider}
                  selectedModel={selectedModel}
                  availableModels={availableModels}
                  loadingModels={loadingModels}
                  deployBusy={busyAction === "deploy-openclaw"}
                  onCloudProviderChange={setSelectedCloudProvider}
                  onProviderChange={handleAiProviderChange}
                  onModelChange={setSelectedModel}
                  onDeploy={() => void handleDeployOpenClaw()}
                  onConfigureCredentials={() => router.push("/dashboard/credentials")}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* ── Right: deployments list ── */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>Seus ambientes</CardTitle>
                <CardDescription>
                  Agentes OpenClaw provisionados na nuvem. Ambientes gratuitos podem levar até 1
                  minuto para acordar.
                </CardDescription>
              </div>
              <Badge variant="secondary">{deployments.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {deployments.length === 0 ? (
              <Empty className="border-border/60">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ServerIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhum ambiente criado</EmptyTitle>
                  <EmptyDescription>
                    Conecte um provedor cloud, selecione o provider de IA e o modelo, e clique em
                    Deploy OpenClaw.
                  </EmptyDescription>
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
                    onUpdateOpenClaw={(deploymentId, payload) =>
                      void handleUpdateOpenClaw(deploymentId, payload)
                    }
                    onChat={(deploymentId) => router.push(`/chat?openclaw=${deploymentId}`)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover ambiente OpenClaw?</AlertDialogTitle>
            <AlertDialogDescription>
              O serviço será removido do provedor cloud. Esta ação é irreversível e interrompe a URL
              pública do ambiente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => (pendingDelete ? void handleDeleteDeployment(pendingDelete) : undefined)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TokenDialog
        state={tokenDialog}
        copied={copied}
        onCopy={(value) => void handleCopyToken(value)}
        onClose={() => {
          setTokenDialog(null);
          setCopied(false);
        }}
      />
    </>
  );
}
