"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CloudIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  Globe2Icon,
  KeyRoundIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PlayIcon,
  SaveIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { apiJsonRequest, testProviderCredentials } from "@/lib/api";
import type { UiProvider } from "@/lib/contracts";
import {
  providerAuthMode,
  providerCredentialIds,
  providerHasRequiredCredentials,
  providerUsesBrowserSession,
  providerUsesStoredCredentials,
  sortProvidersByConfiguredCredentials,
} from "@/lib/provider-credentials";

type IntegrationTab = "all" | "connected" | "api" | "subscription" | "free" | "local";
type IntegrationKind = "api" | "browser" | "free" | "local" | "subscription";

const TAB_ITEMS: Array<{
  value: IntegrationTab;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    value: "all",
    label: "Todas",
    hint: "Visao completa das integracoes, com providers prontos, locais e os que ainda precisam de credencial.",
    icon: SparklesIcon,
  },
  {
    value: "connected",
    label: "Conectadas",
    hint: "Providers com credenciais salvas aparecem aqui para teste rapido, troca ou desconexao.",
    icon: CheckCircle2Icon,
  },
  {
    value: "api",
    label: "API keys",
    hint: "Providers tradicionais que usam chave, token ou variavel de ambiente para liberar chamadas.",
    icon: KeyRoundIcon,
  },
  {
    value: "subscription",
    label: "Assinaturas",
    hint: "Providers baseados em plano, conta paga, token de assinatura ou fluxo equivalente.",
    icon: CloudIcon,
  },
  {
    value: "free",
    label: "Gratis/Browser",
    hint: "Providers sem chave salva no setup, incluindo opcoes gratuitas e login pelo navegador.",
    icon: Globe2Icon,
  },
  {
    value: "local",
    label: "Local",
    hint: "Runtimes locais e endpoints que dependem de servicos rodando na maquina ou na rede.",
    icon: ServerIcon,
  },
];

const SUBSCRIPTION_PROVIDER_IDS = new Set([
  "bytepluscoding",
  "commandcode",
  "copilot",
  "ollamacloud",
  "openai",
  "opencodego",
  "qwentoken",
  "xaisubscription",
  "xiaomitoken",
  "zaicoding",
]);

function getIntegrationKind(provider: UiProvider): IntegrationKind {
  if (provider.id === "ollama" || provider.label.toLowerCase().includes("(local)")) {
    return "local";
  }

  if (providerUsesBrowserSession(provider)) {
    return "browser";
  }

  if (providerAuthMode(provider) === "none") {
    return "free";
  }

  const normalizedLabel = provider.label.toLowerCase();
  if (
    SUBSCRIPTION_PROVIDER_IDS.has(provider.id) ||
    normalizedLabel.includes("assinatura") ||
    normalizedLabel.includes("subscription")
  ) {
    return "subscription";
  }

  return "api";
}

function integrationKindLabel(kind: IntegrationKind): string {
  switch (kind) {
    case "api":
      return "API key";
    case "browser":
      return "Browser";
    case "free":
      return "Gratis";
    case "local":
      return "Local";
    case "subscription":
      return "Assinatura";
  }
}

function providerInitials(label: string): string {
  const words = label
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) return "AI";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function integrationKindIcon(kind: IntegrationKind): LucideIcon {
  switch (kind) {
    case "api":
      return KeyRoundIcon;
    case "browser":
      return Globe2Icon;
    case "free":
      return SparklesIcon;
    case "local":
      return ServerIcon;
    case "subscription":
      return CloudIcon;
  }
}

export function SetupPage() {
  const { credentials, providers, refreshCredentials } = useAppState();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "ok" | "fail">>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [pendingDisconnect, setPendingDisconnect] = useState<UiProvider | null>(null);
  const [activeTab, setActiveTab] = useState<IntegrationTab>("all");
  const [query, setQuery] = useState("");

  const sortedProviders = useMemo(
    () => sortProvidersByConfiguredCredentials(providers, credentials),
    [credentials, providers],
  );
  const freeProviders = useMemo(
    () => sortedProviders.filter((provider) => getIntegrationKind(provider) === "free"),
    [sortedProviders],
  );
  const browserSessionProviders = useMemo(
    () => sortedProviders.filter((provider) => getIntegrationKind(provider) === "browser"),
    [sortedProviders],
  );
  const localProviders = useMemo(
    () => sortedProviders.filter((provider) => getIntegrationKind(provider) === "local"),
    [sortedProviders],
  );
  const subscriptionProviders = useMemo(
    () => sortedProviders.filter((provider) => getIntegrationKind(provider) === "subscription"),
    [sortedProviders],
  );
  const apiKeyProviders = useMemo(
    () => sortedProviders.filter((provider) => getIntegrationKind(provider) === "api"),
    [sortedProviders],
  );
  const credentialedProviders = useMemo(
    () => sortedProviders.filter(providerUsesStoredCredentials),
    [sortedProviders],
  );
  const configuredProviders = useMemo(
    () => credentialedProviders.filter((p) => providerHasRequiredCredentials(p, credentials)),
    [credentialedProviders, credentials],
  );
  const availableProviders = useMemo(
    () => credentialedProviders.filter((p) => !providerHasRequiredCredentials(p, credentials)),
    [credentialedProviders, credentials],
  );
  const visibleProviders = useMemo(
    () => {
      const normalizedQuery = query.trim().toLowerCase();
      return sortedProviders.filter((provider) => {
        const kind = getIntegrationKind(provider);
        const isConfigured =
          providerUsesStoredCredentials(provider) &&
          providerHasRequiredCredentials(provider, credentials);
        const matchesTab =
          activeTab === "all" ||
          (activeTab === "connected" && isConfigured) ||
          (activeTab === "api" && kind === "api") ||
          (activeTab === "subscription" && kind === "subscription") ||
          (activeTab === "free" && (kind === "free" || kind === "browser")) ||
          (activeTab === "local" && kind === "local");

        if (!matchesTab) return false;
        if (!normalizedQuery) return true;

        return [
          provider.id,
          provider.label,
          provider.requiredEnv ?? "",
          provider.signupLabel ?? "",
          integrationKindLabel(kind),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      });
    },
    [activeTab, credentials, query, sortedProviders],
  );
  const configuredCount = configuredProviders.length;
  const readyWithoutCredentialsCount = useMemo(
    () => [...freeProviders, ...browserSessionProviders, ...localProviders].length,
    [browserSessionProviders, freeProviders, localProviders],
  );
  const tabCounts = useMemo(
    () => ({
      all: providers.length,
      api: apiKeyProviders.length,
      connected: configuredProviders.length,
      free: freeProviders.length + browserSessionProviders.length,
      local: localProviders.length,
      subscription: subscriptionProviders.length,
    }),
    [apiKeyProviders, browserSessionProviders, configuredProviders, freeProviders, localProviders, providers, subscriptionProviders],
  );
  const activeTabMeta = TAB_ITEMS.find((item) => item.value === activeTab) ?? TAB_ITEMS[0];
  const ActiveTabIcon = activeTabMeta.icon;

  function toggleExpand(providerId: string) {
    if (expandedId === providerId) {
      setExpandedId(null);
      setValues({});
      setShowValues({});
    } else {
      setExpandedId(providerId);
      setValues({});
      setShowValues({});
    }
  }

  async function handleSave(provider: UiProvider) {
    const requiredKeys = provider.requiredKeys ?? [];
    if (requiredKeys.some((f) => !values[f.envName]?.trim())) {
      toast.error("Preencha todos os campos.");
      return;
    }

    // 1. Testar credenciais antes de salvar
    setTesting(provider.id);
    try {
      const creds: Record<string, string> = {};
      for (const f of requiredKeys) {
        creds[f.envName] = values[f.envName];
      }

      const testResult = await testProviderCredentials(provider.base, creds);

      if (!testResult.ok) {
        toast.error(testResult.error ?? "Chave inválida. Verifique e tente novamente.");
        return;
      }

      if (testResult.skipped) {
        toast.info("Teste de conexão não disponível para este provider. Salvando mesmo assim.");
      }
    } catch {
      toast.warning("Não foi possível testar a conexão. Salvando mesmo assim.");
    } finally {
      setTesting(null);
    }

    // 2. Salvar credenciais
    setSaving(provider.id);
    try {
      await Promise.all(
        requiredKeys.map((f) =>
          apiJsonRequest("/user/credentials", "POST", {
            credentialKey: f.envName,
            credentialValue: values[f.envName],
            providerId: provider.id,
          }),
        ),
      );
      await refreshCredentials();
      setExpandedId(null);
      setValues({});
      toast.success(`${provider.label} conectado!`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(null);
    }
  }

  async function handleTest(provider: UiProvider) {
    setTesting(provider.id);
    try {
      const result = await testProviderCredentials(provider.base, {});
      if (result.ok) {
        setTestResults((cur) => ({ ...cur, [provider.id]: "ok" }));
        toast.success(`${provider.label}: conexão OK!`);
      } else if (result.skipped) {
        toast.info(`${provider.label}: teste não disponível para este provider.`);
      } else {
        setTestResults((cur) => ({ ...cur, [provider.id]: "fail" }));
        toast.error(`${provider.label}: ${result.error ?? "falha na conexão."}`);
      }
    } catch {
      setTestResults((cur) => ({ ...cur, [provider.id]: "fail" }));
      toast.error(`${provider.label}: erro ao testar conexão.`);
    } finally {
      setTesting(null);
    }
  }

  async function handleDisconnect(provider: UiProvider) {
    setSaving(provider.id);
    try {
      const ids = providerCredentialIds(provider.id, credentials);
      await Promise.all(ids.map((id) => apiJsonRequest(`/user/credentials/${id}`, "DELETE")));
      await refreshCredentials();
      setPendingDisconnect(null);
      setTestResults((cur) => {
        const next = { ...cur };
        delete next[provider.id];
        return next;
      });
      toast.success(`${provider.label} desconectado.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover.");
    } finally {
      setSaving(null);
    }
  }

  function renderPaidProviderCard(provider: UiProvider) {
    const kind = getIntegrationKind(provider);
    const KindIcon = integrationKindIcon(kind);
    const isConfigured = providerHasRequiredCredentials(provider, credentials);
    const isExpanded = expandedId === provider.id;
    const isSaving = saving === provider.id;
    const isTesting = testing === provider.id;
    const isBusy = isSaving || isTesting;
    const testResult = testResults[provider.id];
    const hasFailed = testResult === "fail";
    const hasPassedTest = testResult === "ok";

    const cardBorder = hasFailed
      ? "border-red-500/35 bg-red-500/5"
      : isConfigured
        ? "border-green-500/35 bg-green-500/5"
        : "border-border/70 bg-card/80 hover:border-foreground/20";

    const iconBg = hasFailed
      ? "bg-red-500/10"
      : isConfigured
        ? "bg-green-500/10"
        : "bg-muted/70";

    return (
      <Card
        key={provider.id}
        className={`border shadow-none transition-colors ${cardBorder}`}
      >
        <CardContent className="py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`relative flex size-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
                <span className="text-[11px] font-semibold tracking-normal text-foreground">
                  {providerInitials(provider.label)}
                </span>
                <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-background">
                  {hasFailed ? (
                    <AlertCircleIcon className="size-3 text-red-500" />
                  ) : isConfigured ? (
                    <CheckCircle2Icon className="size-3 text-green-500" />
                  ) : (
                    <KindIcon className="size-3 text-muted-foreground" />
                  )}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{provider.label}</p>
                  <Badge variant="outline" className="h-5 gap-1 rounded-md px-1.5 text-[10px]">
                    <KindIcon className="size-3" />
                    {integrationKindLabel(kind)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {hasFailed
                    ? "Falha na conexão"
                    : isConfigured
                      ? hasPassedTest ? "Conectado e testado" : "Conectado"
                      : "Disponível para configurar"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
              {provider.signupUrl && (
                <Button asChild variant="ghost" size="sm" className="text-xs">
                  <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon className="size-3" />
                    <span className="hidden sm:inline">{provider.signupLabel ?? "Obter chave"}</span>
                  </a>
                </Button>
              )}
              {isConfigured ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void handleTest(provider)}
                  >
                    {isTesting ? <Loader2Icon className="size-3 animate-spin" /> : <PlayIcon className="size-3" />}
                    <span className="hidden sm:inline">{isTesting ? "Testando…" : "Testar"}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={isBusy}
                    onClick={() => setPendingDisconnect(provider)}
                  >
                    {isSaving ? <Loader2Icon className="size-3 animate-spin" /> : <Trash2Icon className="size-3" />}
                    <span className="hidden sm:inline">Desconectar</span>
                  </Button>
                </>
              ) : (
                <Button
                  variant={isExpanded ? "secondary" : "default"}
                  size="sm"
                  className="min-w-24"
                  onClick={() => toggleExpand(provider.id)}
                >
                  {isExpanded ? "Cancelar" : "Configurar"}
                </Button>
              )}
            </div>
          </div>

          {isExpanded && !isConfigured ? (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4">
              {provider.signupUrl && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <ExternalLinkIcon className="size-3 shrink-0" />
                  <span>
                    Não tem chave?{" "}
                    <a
                      href={provider.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2"
                    >
                      {provider.signupLabel ?? "Clique aqui para obter"}
                    </a>
                  </span>
                </div>
              )}
              {(provider.requiredKeys ?? []).map((field) => (
                <div key={field.envName} className="flex flex-col gap-1.5">
                  <label htmlFor={`setup-${field.envName}`} className="text-xs font-medium">
                    {field.label}
                  </label>
                  <div className="relative">
                    <Input
                      id={`setup-${field.envName}`}
                      type={showValues[field.envName] ? "text" : "password"}
                      placeholder={field.placeholder}
                      value={values[field.envName] ?? ""}
                      onChange={(e) =>
                        setValues((cur) => ({ ...cur, [field.envName]: e.target.value }))
                      }
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setShowValues((cur) => ({ ...cur, [field.envName]: !cur[field.envName] }))
                      }
                    >
                      {showValues[field.envName] ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                disabled={isBusy}
                onClick={() => void handleSave(provider)}
                className="mt-1 w-fit"
              >
                {isTesting ? (
                  <>
                    <Loader2Icon className="size-3 animate-spin" data-icon="inline-start" />
                    Testando conexão…
                  </>
                ) : isSaving ? (
                  <>
                    <Loader2Icon className="size-3 animate-spin" data-icon="inline-start" />
                    Salvando…
                  </>
                ) : (
                  <>
                    <SaveIcon className="size-3" data-icon="inline-start" />
                    Salvar e conectar
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  function renderInformationalProviderCard(provider: UiProvider) {
    const kind = getIntegrationKind(provider);
    const Icon = integrationKindIcon(kind);
    const description =
      kind === "browser"
        ? "Login acontece no chat, sem salvar API key."
        : kind === "local"
          ? "Roda fora da nuvem do provider; confirme que o servico local esta ativo."
          : "Pronto para testar sem adicionar credencial.";

    return (
      <Card
        key={provider.id}
        className="border border-border/70 bg-card/80 shadow-none transition-colors hover:border-foreground/20"
      >
        <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/70">
              <span className="text-[11px] font-semibold tracking-normal text-foreground">
                {providerInitials(provider.label)}
              </span>
              <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-background">
                <Icon className="size-3 text-muted-foreground" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{provider.label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit shrink-0 gap-1.5 rounded-md">
            <Icon className="size-3" />
            {integrationKindLabel(kind)}
          </Badge>
        </CardContent>
      </Card>
    );
  }

  function renderProviderCard(provider: UiProvider) {
    return providerUsesStoredCredentials(provider)
      ? renderPaidProviderCard(provider)
      : renderInformationalProviderCard(provider);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-6 md:px-6 md:py-12">
      <div className="mb-8 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Conecte seus providers de IA e veja rapidamente o que já está pronto para uso.
        </p>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Prontos sem chave</span>
            <span className="text-2xl font-semibold">{readyWithoutCredentialsCount}</span>
            <span className="text-xs text-muted-foreground">Gratis, browser ou local</span>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">API keys</span>
            <span className="text-2xl font-semibold">{apiKeyProviders.length}</span>
            <span className="text-xs text-muted-foreground">Providers pay-as-you-go</span>
          </CardContent>
        </Card>
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Conectados</span>
            <span className="text-2xl font-semibold">{configuredCount}</span>
            <span className="text-xs text-muted-foreground">Credenciais salvas e prontas</span>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">A configurar</span>
            <span className="text-2xl font-semibold">{availableProviders.length}</span>
            <span className="text-xs text-muted-foreground">Precisam de credencial</span>
          </CardContent>
        </Card>
      </div>

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar provider, tipo ou chave"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {visibleProviders.length} de {providers.length} integracoes
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as IntegrationTab)}>
        <div className="mb-5 rounded-lg border bg-card/70 p-3 shadow-sm">
          <div className="overflow-x-auto pb-1">
            <TabsList className="flex h-auto w-max justify-start rounded-lg border bg-background p-1 shadow-none">
              {TAB_ITEMS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="group/tab h-8 flex-none gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground data-active:bg-foreground data-active:text-background data-active:shadow-sm dark:data-active:bg-foreground dark:data-active:text-background"
                >
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                  <span className="rounded-sm bg-muted px-1.5 py-0 text-[10px] leading-4 text-muted-foreground group-data-[active]/tab:bg-background/20 group-data-[active]/tab:text-background">
                    {tabCounts[value]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ActiveTabIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{activeTabMeta.hint}</span>
          </div>
        </div>

        {(["all", "connected", "api", "subscription", "free", "local"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-0">
            {visibleProviders.length === 0 ? (
              <Card className="border-border/60">
                <CardContent className="py-8 text-sm text-muted-foreground">
                  Nenhuma integracao encontrada para este filtro.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {visibleProviders.map((provider) => renderProviderCard(provider))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <div className="mt-8 flex justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href="/chat">
            <MessageSquareTextIcon data-icon="inline-start" />
            Tudo pronto? Ir para o chat
          </Link>
        </Button>
      </div>

      <AlertDialog open={!!pendingDisconnect} onOpenChange={(open) => { if (!open) setPendingDisconnect(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar provider?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisconnect
                ? `${pendingDisconnect.label} pode deixar de funcionar no chat e no dashboard até que uma nova chave seja salva.`
                : "O provider pode deixar de funcionar até que uma nova chave seja salva."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDisconnect ? void handleDisconnect(pendingDisconnect) : undefined}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
