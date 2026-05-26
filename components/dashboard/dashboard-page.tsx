"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  ApiKeySummary,
  RecentUsageLog,
  UiProvider,
  UsageSummary,
} from "@/lib/contracts";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  TerminalSquareIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import { toast } from "sonner";

import { ApiQuickStartCard } from "@/components/dashboard/api-quick-start-card";
import { useAppState } from "@/components/app-state-provider";
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
import { DEFAULT_MODEL_ID } from "@/lib/defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { apiJson, apiJsonRequest, testProviderCredentials } from "@/lib/api";
import { providerHasRequiredCredentials, providerUsesStoredCredentials } from "@/lib/provider-credentials";

export type DashboardSection = "overview" | "keys" | "credentials" | "logs";

function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: typeof value === "string" && value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

function providerLabel(providerId: string, providers: UiProvider[]) {
  return providers.find((provider) => provider.id === providerId)?.label ?? providerId;
}

function formatLogErrorBody(raw: string | null): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function getErrorRateTone(errorRate: number) {
  if (errorRate >= 20) {
    return {
      description: "Acima do aceitavel. Vale investigar os logs com prioridade.",
      label: "Alerta",
      variant: "destructive" as const,
    };
  }

  if (errorRate >= 5) {
    return {
      description: "Acima do ideal para um fluxo saudavel.",
      label: "Atencao",
      variant: "secondary" as const,
    };
  }

  return {
    description: "Dentro do comportamento esperado.",
    label: "Saudavel",
    variant: "outline" as const,
  };
}

export function DashboardPage({ section = "overview" }: { section?: DashboardSection }) {
  const { credentials, providers, refreshCredentials, refreshUser, user } = useAppState();
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [logs, setLogs] = useState<RecentUsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [usageLogDetail, setUsageLogDetail] = useState<RecentUsageLog | null>(null);
  const [pendingApiKeyRevoke, setPendingApiKeyRevoke] = useState<ApiKeySummary | null>(null);
  const [pendingCredentialDelete, setPendingCredentialDelete] = useState<{
    id: string;
    label: string;
  } | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const hasAnyApiKey = apiKeys.length > 0 || Boolean(newApiKey);
  const readyProvidersCount = useMemo(
    () =>
      providers.filter((provider) => providerHasRequiredCredentials(provider, credentials)).length,
    [credentials, providers],
  );

  function handleCopyCommand(commandId: string, command: string, successMessage: string) {
    void navigator.clipboard.writeText(command).then(() => {
      setCopiedCommandId(commandId);
      toast.success(successMessage);
      setTimeout(() => {
        setCopiedCommandId((current) => (current === commandId ? null : current));
      }, 2000);
    }).catch(() => {
      toast.error("Falha ao copiar comando.");
    });
  }

  async function loadDashboard() {
    setLoading(true);
    try {
      const [keysPayload, usagePayload, logsPayload] = await Promise.all([
        apiJson<{ keys: ApiKeySummary[] }>("/user/api-keys"),
        apiJson<UsageSummary>("/user/usage?days=30"),
        apiJson<{ logs: RecentUsageLog[] }>("/user/usage/recent?limit=20"),
      ]);

      setApiKeys(keysPayload.keys);
      setUsage(usagePayload);
      setLogs(logsPayload.logs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function handleCreateApiKey() {
    try {
      const payload = await apiJsonRequest<{ apiKey: string }>("/user/api-keys", "POST", {
        label: newKeyLabel || undefined,
      });
      setNewApiKey(payload.apiKey);
      setCopiedKey(false);
      setNewKeyDialogOpen(false);
      setNewKeyLabel("");
      await Promise.all([loadDashboard(), refreshUser()]);
      toast.success("Nova API key criada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar API key.");
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    try {
      await apiJsonRequest(`/user/api-keys/${keyId}`, "DELETE");
      setPendingApiKeyRevoke(null);
      await Promise.all([loadDashboard(), refreshUser()]);
      toast.success("API key revogada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao revogar API key.");
    }
  }

  async function handleDeleteCredential(credentialId: string) {
    try {
      await apiJsonRequest(`/user/credentials/${credentialId}`, "DELETE");
      setPendingCredentialDelete(null);
      await Promise.all([refreshCredentials(), refreshUser()]);
      toast.success("Credencial removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover credencial.");
    }
  }

  async function handleSaveCredentials() {
    if (!selectedProvider) {
      toast.error("Selecione um provider.");
      return;
    }

    const requiredKeys = selectedProvider.requiredKeys ?? [];
    if (requiredKeys.length === 0) {
      toast.error("Esse provider não exige credenciais adicionais.");
      return;
    }

    if (requiredKeys.some((field) => !credentialValues[field.envName]?.trim())) {
      toast.error("Preencha todos os campos do provider.");
      return;
    }

    setSavingCredentials(true);
    try {
      // 1. Testar credenciais
      const creds: Record<string, string> = {};
      for (const f of requiredKeys) {
        creds[f.envName] = credentialValues[f.envName];
      }

      const testResult = await testProviderCredentials(selectedProvider.base, creds);
      if (!testResult.ok && !testResult.skipped) {
        toast.error(testResult.error ?? "Chave inválida. Verifique e tente novamente.");
        return;
      }

      // 2. Salvar credenciais
      await Promise.all(
        requiredKeys.map((field) =>
          apiJsonRequest("/user/credentials", "POST", {
            credentialKey: field.envName,
            credentialValue: credentialValues[field.envName],
            providerId: selectedProvider.id,
          }),
        ),
      );
      setCredentialDialogOpen(false);
      setCredentialValues({});
      await Promise.all([refreshCredentials(), refreshUser()]);
      toast.success(`Credenciais salvas para ${selectedProvider.label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar credenciais.");
    } finally {
      setSavingCredentials(false);
    }
  }

  if (loading && !usage) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 p-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">A carregar o dashboard…</span>
      </div>
    );
  }

  const providerChartData = usage?.byProvider.slice(0, 6) ?? [];
  const dailyChartData = usage?.daily ?? [];
  const errorRateTone = getErrorRateTone(usage?.errorRate ?? 0);
  const showQuickStart = !hasAnyApiKey;
  const hasLogDetails = logs.some((log) => log.statusCode >= 400 || Boolean(log.errorDetail));
  const totalProviderRequests = providerChartData.reduce((sum, item) => sum + item.count, 0);
  const sectionLinks: Array<{ count?: number; href: string; id: DashboardSection; label: string }> = [
    { href: "/dashboard", id: "overview", label: "Visão geral" },
    { count: apiKeys.length, href: "/dashboard/api-keys", id: "keys", label: "API Keys" },
    { count: credentials.length, href: "/dashboard/credentials", id: "credentials", label: "Credenciais" },
    { count: logs.length, href: "/dashboard/logs", id: "logs", label: "Logs de uso" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-3 md:gap-6 md:p-6">
      <Dialog open={!!newApiKey} onOpenChange={(open) => { if (!open) setNewApiKey(null); }}>
        <DialogContent className="max-h-[min(90vh,40rem)] w-[calc(100vw-2rem)] max-w-2xl gap-4 overflow-y-auto overflow-x-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0 text-left">
            <DialogTitle>API key criada com sucesso</DialogTitle>
            <DialogDescription>
              Copie a key abaixo. Ela não poderá ser exibida novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-2">
            <code className="block max-h-32 min-h-0 w-full min-w-0 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all sm:text-sm">
              {newApiKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="w-full shrink-0 sm:w-auto"
              onClick={() => {
                if (newApiKey) {
                  void navigator.clipboard.writeText(newApiKey);
                  setCopiedKey(true);
                  toast.success("API key copiada!");
                  setTimeout(() => setCopiedKey(false), 2000);
                }
              }}
            >
              {copiedKey ? <CheckIcon className="mr-2 size-4" /> : <CopyIcon className="mr-2 size-4" />}
              Copiar API key
            </Button>
          </div>
          {newApiKey ? (
            <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-3 rounded-xl border border-chart-2/20 bg-chart-2/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chart-2/10">
                    <TerminalSquareIcon className="size-4 text-chart-2" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">Usar pela API</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Copie o exemplo abaixo para fazer sua primeira requisição.
                    </p>
                  </div>
                </div>
                <pre className="max-h-48 min-w-0 overflow-auto rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed">
                  <code className="block min-w-0 break-all whitespace-pre-wrap">{`curl -X POST https://www.modelhub.com.br/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${newApiKey}" \\
  -d '{"model": "${DEFAULT_MODEL_ID}", "messages": [{"role": "user", "content": "Olá!"}]}'`}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cmd = `curl -X POST https://www.modelhub.com.br/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer ${newApiKey}" -d '{"model": "${DEFAULT_MODEL_ID}", "messages": [{"role": "user", "content": "Olá!"}]}'`;
                    void navigator.clipboard.writeText(cmd).then(() => {
                      handleCopyCommand("dialog-curl", cmd, "Comando cURL copiado!");
                    });
                  }}
                >
                  {copiedCommandId === "dialog-curl" ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
                  Copiar cURL
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="-mx-3 overflow-x-auto px-3 md:mx-0 md:px-0">
        <div className="flex min-w-max items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-1">
          {sectionLinks.map((item) => (
            <Button
              key={item.id}
              asChild
              size="sm"
              variant={section === item.id ? "secondary" : "ghost"}
              className="rounded-lg"
            >
              <Link href={item.href}>
                <span>{item.label}</span>
                {typeof item.count === "number" ? (
                  <span className="text-xs text-muted-foreground">({item.count})</span>
                ) : null}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {section === "overview" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardDescription>Requests em 30 dias</CardDescription>
                <CardTitle className="text-3xl">{usage?.totalRequests ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Volume total por usuário autenticado.</CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardDescription>Taxa de erro</CardDescription>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-3xl">{usage?.errorRate ?? 0}%</CardTitle>
                  <Badge variant={errorRateTone.variant} className="mt-1 gap-1.5">
                    <AlertTriangleIcon />
                    {errorRateTone.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{errorRateTone.description}</CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardDescription>API keys ativas</CardDescription>
                <CardTitle className="text-3xl">{user?.counts?.activeApiKeys ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">Keys disponíveis para clientes externos.</CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardDescription>Providers prontos</CardDescription>
                <CardTitle className="text-3xl">{readyProvidersCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Conectados ou gratuitos, disponiveis para uso imediato.
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Uso diário</CardTitle>
                <CardDescription>Últimos 30 dias.</CardDescription>
              </CardHeader>
              <CardContent>
                {dailyChartData.length === 0 ? (
                  <Empty className="border-border/60">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BarChart3Icon />
                      </EmptyMedia>
                      <EmptyTitle>Sem atividade neste período</EmptyTitle>
                      <EmptyDescription>Os requests dos últimos 30 dias aparecerão aqui quando houver uso.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-3">
                    <ChartContainer
                      config={{
                        count: {
                          color: "var(--color-chart-1)",
                          label: "Requests",
                        },
                      }}
                      className="h-[280px] w-full"
                    >
                      <LineChart data={dailyChartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) =>
                            new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(value))
                          }
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line
                          dataKey="count"
                          type="monotone"
                          stroke="var(--color-count)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ChartContainer>
                    <p className="text-xs text-muted-foreground">
                      Dias sem pontos indicam ausência de requests, não falha no gráfico.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Top providers</CardTitle>
                <CardDescription>Distribuição por volume de requests.</CardDescription>
              </CardHeader>
              <CardContent>
                {providerChartData.length === 0 ? (
                  <Empty className="border-border/60">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ActivityIcon />
                      </EmptyMedia>
                      <EmptyTitle>Nenhum provider com uso recente</EmptyTitle>
                      <EmptyDescription>
                        Quando houver requests, você verá a distribuição por provider aqui.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-3">
                    {providerChartData.map((item) => {
                      const percentage = totalProviderRequests > 0
                        ? Math.round((item.count / totalProviderRequests) * 100)
                        : 0;

                      return (
                        <div key={item.provider} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium">{providerLabel(item.provider, providers)}</span>
                            <span className="text-xs text-muted-foreground">{item.count} req ({percentage}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-chart-2 transition-[width]"
                              style={{ width: `${Math.max(percentage, 6)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {showQuickStart ? (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
                        <TerminalSquareIcon className="size-4 text-primary" />
                      </div>
                      <CardTitle>Primeiros passos</CardTitle>
                    </div>
                    <CardDescription className="max-w-2xl leading-relaxed">
                      Gere sua primeira API key e faça a primeira requisição pela API compatível com OpenAI.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                      <CheckCircle2Icon className="size-3" />
                      API OpenAI-compatible
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <ApiQuickStartCard apiKey={newApiKey} hasApiKey={hasAnyApiKey} />

                <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/70 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Precisa de uma API key?</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Gere uma chave para acessar a API e integrar seus clientes externos.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setNewKeyDialogOpen(true)}>
                      <KeyRoundIcon data-icon="inline-start" />
                      Nova key
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Conta</CardTitle>
              <CardDescription>Resumo operacional da sessão autenticada.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ActivityIcon className="size-4 text-primary" />
                  Email
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{user?.email}</p>
              </div>
              <div className="rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <BarChart3Icon className="size-4 text-primary" />
                  Criado em
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{formatDate(user?.createdAt ?? null)}</p>
              </div>
              <div className="rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangleIcon className="size-4 text-primary" />
                  Requests totais
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{user?.counts?.totalRequests ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {section === "keys" ? (
        <Card className="border-border/60">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>API Keys</CardTitle>
              <CardDescription>Gere e revogue chaves para seus clientes externos.</CardDescription>
            </div>
            <Button onClick={() => setNewKeyDialogOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Nova key
            </Button>
          </CardHeader>
          <CardContent>
            {apiKeys.length === 0 ? (
              <Empty className="border-border/60">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyRoundIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma API key ativa</EmptyTitle>
                  <EmptyDescription>Crie uma nova key para começar a consumir o proxy externamente.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <div className="grid gap-3 md:hidden">
                  {apiKeys.map((apiKey) => (
                    <Card key={apiKey.id} className="border-border/60">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{apiKey.label || "Sem label"}</p>
                            <code className="text-xs text-muted-foreground">{apiKey.prefix}...</code>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setPendingApiKeyRevoke(apiKey)}>
                            <Trash2Icon data-icon="inline-start" />
                            Revogar
                          </Button>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground">
                          <p>Criada em {formatDate(apiKey.createdAt)}</p>
                          <p>Último uso: {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "Nunca usada"}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefixo</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Criada</TableHead>
                        <TableHead>Último uso</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiKeys.map((apiKey) => (
                        <TableRow key={apiKey.id}>
                          <TableCell><code>{apiKey.prefix}...</code></TableCell>
                          <TableCell>{apiKey.label || "—"}</TableCell>
                          <TableCell>{formatDate(apiKey.createdAt)}</TableCell>
                          <TableCell>{apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "Nunca usada"}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setPendingApiKeyRevoke(apiKey)}>
                              <Trash2Icon data-icon="inline-start" />
                              Revogar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {section === "credentials" ? (
        <Card className="border-border/60">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>Credenciais de providers</CardTitle>
              <CardDescription>Gerencie as chaves usadas para conectar providers pagos e autenticados.</CardDescription>
            </div>
            <Button onClick={() => setCredentialDialogOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Adicionar
            </Button>
          </CardHeader>
          <CardContent>
            {credentials.length === 0 ? (
              <Empty className="border-border/60">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ShieldCheckIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma credencial salva</EmptyTitle>
                  <EmptyDescription>Adicione as chaves dos providers pagos ou autenticados.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <div className="grid gap-3 md:hidden">
                  {credentials.map((credential) => (
                    <Card key={credential.id} className="border-border/60">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{providerLabel(credential.providerId, providers)}</p>
                            <code className="text-xs text-muted-foreground">{credential.credentialKey}</code>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingCredentialDelete({
                              id: credential.id,
                              label: providerLabel(credential.providerId, providers),
                            })}
                          >
                            <Trash2Icon data-icon="inline-start" />
                            Remover
                          </Button>
                        </div>
                        <div className="grid gap-1 text-xs text-muted-foreground">
                          <p>Identificador salvo para este provider</p>
                          <p>Atualizada em {formatDate(credential.updatedAt)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Credencial</TableHead>
                        <TableHead>Atualizada</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {credentials.map((credential) => (
                        <TableRow key={credential.id}>
                          <TableCell>{providerLabel(credential.providerId, providers)}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <code>{credential.credentialKey}</code>
                              <span className="text-[10px] text-muted-foreground">Identificador salvo para este provider</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(credential.updatedAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingCredentialDelete({
                                id: credential.id,
                                label: providerLabel(credential.providerId, providers),
                              })}
                            >
                              <Trash2Icon data-icon="inline-start" />
                              Remover
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {section === "logs" ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Logs recentes</CardTitle>
            <CardDescription>Últimos requests autenticados associados ao seu usuário.</CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <Empty className="border-border/60">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ActivityIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhum log recente</EmptyTitle>
                  <EmptyDescription>Os logs aparecerão aqui conforme você usa os endpoints protegidos.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <div className="grid gap-3 md:hidden">
                  {logs.map((log) => (
                    <Card key={log.id} className="border-border/60">
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{providerLabel(log.providerId ?? "—", providers)}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</p>
                          </div>
                          <Badge variant={log.statusCode >= 400 ? "destructive" : "secondary"}>
                            {log.statusCode}
                          </Badge>
                        </div>
                        <div className="grid gap-1 text-xs text-muted-foreground">
                          <p>Modelo: {log.modelId ?? "—"}</p>
                          <p>Key: {log.apiKey ? `${log.apiKey.prefix}...` : "—"}</p>
                        </div>
                        {log.statusCode >= 400 || (log.errorDetail && log.errorDetail.length > 0) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setUsageLogDetail(log)}
                          >
                            <FileTextIcon data-icon="inline-start" />
                            Ver detalhes
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Modelo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Key</TableHead>
                        {hasLogDetails ? <TableHead className="w-12 text-right">Detalhes</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{formatDate(log.createdAt)}</TableCell>
                          <TableCell className="text-xs">{providerLabel(log.providerId ?? "—", providers)}</TableCell>
                          <TableCell className="text-xs">{log.modelId ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={log.statusCode >= 400 ? "destructive" : "secondary"}>
                              {log.statusCode}
                            </Badge>
                          </TableCell>
                          <TableCell>{log.apiKey ? `${log.apiKey.prefix}...` : "—"}</TableCell>
                          {hasLogDetails ? (
                            <TableCell className="text-right">
                              {log.statusCode >= 400 || (log.errorDetail && log.errorDetail.length > 0) ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => setUsageLogDetail(log)}
                                  aria-label={
                                    log.statusCode >= 400
                                      ? "Ver detalhes do erro"
                                      : "Ver detalhes (ex.: falha antes de fallback)"
                                  }
                                >
                                  <FileTextIcon className="size-4" />
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
          {!hasLogDetails && logs.length > 0 ? (
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">Nenhum dos logs recentes possui detalhes adicionais para exibir.</p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Dialog open={!!usageLogDetail} onOpenChange={(open) => { if (!open) setUsageLogDetail(null); }}>
        <DialogContent className="max-h-[min(90vh,40rem)] w-[calc(100vw-2rem)] max-w-2xl gap-4 overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0 text-left">
            <DialogTitle>
              {usageLogDetail && usageLogDetail.statusCode < 400 && usageLogDetail.errorDetail
                ? "Detalhes da requisição"
                : "Detalhes do erro"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                {usageLogDetail ? (
                  <>
                    <p>
                      <span className="font-medium text-foreground">Status:</span> {usageLogDetail.statusCode}
                      {" · "}
                      <span className="font-medium text-foreground">Provider:</span>{" "}
                      {providerLabel(usageLogDetail.providerId ?? "—", providers)}
                      {" · "}
                      <span className="font-medium text-foreground">Modelo:</span> {usageLogDetail.modelId ?? "—"}
                    </p>
                    {usageLogDetail.endpoint ? (
                      <p className="font-mono text-xs break-all">{usageLogDetail.endpoint}</p>
                    ) : null}
                    <p className="text-xs">{formatDate(usageLogDetail.createdAt)}</p>
                  </>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[min(55vh,24rem)] rounded-lg border border-border/80">
            <pre className="max-w-full p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
              {usageLogDetail?.errorDetail
                ? formatLogErrorBody(usageLogDetail.errorDetail)
                : "Nenhum corpo de erro foi armazenado para este log (registros antigos ou resposta não legível)."}
            </pre>
          </ScrollArea>
          {usageLogDetail?.errorDetail ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                const text = formatLogErrorBody(usageLogDetail.errorDetail);
                void navigator.clipboard.writeText(text).then(() => {
                  toast.success("Detalhes copiados.");
                }).catch(() => {
                  toast.error("Falha ao copiar.");
                });
              }}
            >
              <CopyIcon className="mr-2 size-4" />
              Copiar detalhes
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingApiKeyRevoke} onOpenChange={(open) => { if (!open) setPendingApiKeyRevoke(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar API key?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingApiKeyRevoke
                ? `A key ${pendingApiKeyRevoke.prefix}... deixará de funcionar imediatamente para clientes externos.`
                : "A key deixará de funcionar imediatamente para clientes externos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingApiKeyRevoke ? void handleRevokeApiKey(pendingApiKeyRevoke.id) : undefined}
            >
              Revogar key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingCredentialDelete} onOpenChange={(open) => { if (!open) setPendingCredentialDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover credencial?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCredentialDelete
                ? `A integração com ${pendingCredentialDelete.label} pode parar de funcionar até que uma nova chave seja salva.`
                : "A integração pode parar de funcionar até que uma nova chave seja salva."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingCredentialDelete ? void handleDeleteCredential(pendingCredentialDelete.id) : undefined}
            >
              Remover credencial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={newKeyDialogOpen} onOpenChange={setNewKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova API key</DialogTitle>
            <DialogDescription>Opcionalmente defina um label para identificar a key depois.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key-label">Label</FieldLabel>
              <Input
                id="api-key-label"
                placeholder="Ex: CLI local"
                value={newKeyLabel}
                onChange={(event) => setNewKeyLabel(event.target.value)}
              />
              <FieldDescription>Se vazio, o backend usa o label padrão.</FieldDescription>
            </Field>
          </FieldGroup>
          <Button onClick={() => void handleCreateApiKey()}>Criar key</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar credenciais</DialogTitle>
            <DialogDescription>Selecione um provider e informe as chaves exigidas por ele.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel>Provider</FieldLabel>
                <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {providers.filter(providerUsesStoredCredentials).map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {selectedProvider?.signupUrl && (
                <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 px-3 py-2.5 text-sm text-blue-600 dark:text-blue-400">
                  <ExternalLinkIcon className="size-4 shrink-0" />
                  <span>
                    Não tem chave?{" "}
                    <a
                      href={selectedProvider.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2"
                    >
                      {selectedProvider.signupLabel ?? "Clique aqui para obter"}
                    </a>
                  </span>
                </div>
              )}
              {(selectedProvider?.requiredKeys ?? []).map((field) => (
                <Field key={field.envName}>
                  <FieldLabel htmlFor={field.envName}>{field.label}</FieldLabel>
                  <Input
                    id={field.envName}
                    type="password"
                    placeholder={field.placeholder}
                    value={credentialValues[field.envName] ?? ""}
                    onChange={(event) =>
                      setCredentialValues((current) => ({
                        ...current,
                        [field.envName]: event.target.value,
                      }))
                    }
                  />
                  <FieldDescription>Informe a chave recebida no painel deste provider.</FieldDescription>
                </Field>
              ))}
            </FieldGroup>
            <Button disabled={savingCredentials} onClick={() => void handleSaveCredentials()}>
              {savingCredentials && <Loader2Icon className="size-3 animate-spin" />}
              {savingCredentials ? "Testando conexão…" : "Salvar credenciais"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
