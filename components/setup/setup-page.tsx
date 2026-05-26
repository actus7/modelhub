"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PlayIcon,
  SaveIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
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

export function SetupPage() {
  const { credentials, providers, refreshCredentials } = useAppState();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "ok" | "fail">>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [pendingDisconnect, setPendingDisconnect] = useState<UiProvider | null>(null);

  const freeProviders = useMemo(
    () => providers.filter((provider) => providerAuthMode(provider) === "none"),
    [providers],
  );
  const browserSessionProviders = useMemo(
    () => providers.filter(providerUsesBrowserSession),
    [providers],
  );
  const paidProviders = useMemo(
    () => sortProvidersByConfiguredCredentials(
      providers.filter(providerUsesStoredCredentials),
      credentials,
    ),
    [credentials, providers],
  );
  const configuredCount = useMemo(
    () => paidProviders.filter((p) => providerHasRequiredCredentials(p, credentials)).length,
    [paidProviders, credentials],
  );
  const configuredProviders = useMemo(
    () => paidProviders.filter((p) => providerHasRequiredCredentials(p, credentials)),
    [paidProviders, credentials],
  );
  const availableProviders = useMemo(
    () => paidProviders.filter((p) => !providerHasRequiredCredentials(p, credentials)),
    [paidProviders, credentials],
  );

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
    const isConfigured = providerHasRequiredCredentials(provider, credentials);
    const isExpanded = expandedId === provider.id;
    const isSaving = saving === provider.id;
    const isTesting = testing === provider.id;
    const isBusy = isSaving || isTesting;
    const testResult = testResults[provider.id];
    const hasFailed = testResult === "fail";
    const hasPassedTest = testResult === "ok";

    const cardBorder = hasFailed
      ? "border-red-500/30 bg-red-500/5"
      : isConfigured
        ? "border-green-500/30 bg-green-500/5"
        : "border-border/60";

    const iconBg = hasFailed
      ? "bg-red-500/10"
      : isConfigured
        ? "bg-green-500/10"
        : "bg-muted";

    return (
      <Card
        key={provider.id}
        className={`border transition-colors ${cardBorder}`}
      >
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex size-9 items-center justify-center rounded-lg ${iconBg}`}
              >
                {hasFailed ? (
                  <AlertCircleIcon className="size-4 text-red-500" />
                ) : isConfigured ? (
                  <CheckCircle2Icon className="size-4 text-green-500" />
                ) : (
                  <KeyRoundIcon className="size-4 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{provider.label}</p>
                <p className="text-xs text-muted-foreground">
                  {hasFailed
                    ? "Falha na conexão"
                    : isConfigured
                      ? hasPassedTest ? "Conectado e testado" : "Conectado"
                      : "Disponível para configurar"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
                <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
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

      <div className="mb-8 grid gap-3 md:grid-cols-4">
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Gratuitos</span>
            <span className="text-2xl font-semibold">{freeProviders.length}</span>
            <span className="text-xs text-muted-foreground">Disponíveis sem configurar</span>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Browser</span>
            <span className="text-2xl font-semibold">{browserSessionProviders.length}</span>
            <span className="text-xs text-muted-foreground">Usam sessao autenticada no navegador</span>
          </CardContent>
        </Card>
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Conectados</span>
            <span className="text-2xl font-semibold">{configuredCount}</span>
            <span className="text-xs text-muted-foreground">Providers pagos já prontos para uso</span>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium text-muted-foreground">Disponíveis</span>
            <span className="text-2xl font-semibold">{availableProviders.length}</span>
            <span className="text-xs text-muted-foreground">Ainda aguardando configuração</span>
          </CardContent>
        </Card>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CheckCircle2Icon className="size-4 text-green-500" />
          Gratuitos disponíveis
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {freeProviders.map((p) => (
            <Card key={p.id} className="border-border/60">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">Pronto para testar sem adicionar chave</p>
                </div>
                <Badge variant="secondary" className="gap-1.5">
                  <CheckCircle2Icon className="size-3 text-green-500" />
                  Gratuito
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {browserSessionProviders.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <KeyRoundIcon className="size-4 text-primary" />
            Sessao do navegador
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {browserSessionProviders.map((provider) => (
              <Card key={provider.id} className="border-border/60">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{provider.label}</p>
                    <p className="text-xs text-muted-foreground">Login acontece no chat, sem salvar API key</p>
                  </div>
                  <Badge variant="outline" className="gap-1.5">
                    <KeyRoundIcon className="size-3" />
                    Browser
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CheckCircle2Icon className="size-4 text-green-500" />
          Conectados
        </h2>
      </div>

      <div className="mb-8 flex flex-col gap-3">
        {configuredProviders.length === 0 ? (
          <Card className="border-border/60">
            <CardContent className="py-6 text-sm text-muted-foreground">
              Nenhum provider pago conectado ainda.
            </CardContent>
          </Card>
        ) : (
          configuredProviders.map((provider) => renderPaidProviderCard(provider))
        )}
      </div>

      <div className="mb-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <KeyRoundIcon className="size-4" />
          Disponíveis para configurar
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {availableProviders.map((provider) => renderPaidProviderCard(provider))}
      </div>

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
