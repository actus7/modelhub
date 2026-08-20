"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  MessageSquareIcon,
  MonitorSmartphoneIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useAppState } from "@/components/app-state-provider"
import { ProviderAvatar } from "@/components/dashboard/routing/provider-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { apiJsonRequest } from "@/lib/api"
import type { ProviderModel } from "@/lib/contracts"
import {
  providerAuthMode,
  providerHasRequiredCredentials,
} from "@/lib/provider-credentials"
import { saveProviderCredentials } from "@/lib/save-provider-credentials"
import { useProviderModels } from "@/lib/use-provider-models"

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "data indisponível"
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function modelCapabilityLabels(model: ProviderModel): string[] {
  const labels: string[] = []
  if (model.capabilities.reasoning) labels.push("Raciocínio")
  if (model.capabilities.tools) labels.push("Ferramentas")
  if (model.capabilities.images) labels.push("Imagens")
  if (model.capabilities.documents) labels.push("Documentos")
  if (model.capabilities.fast) labels.push("Rápido")
  return labels
}

function ProviderDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-3 md:p-6">
      <Skeleton className="h-9 w-40" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

export function ProviderDetail({ providerId }: { providerId: string }) {
  const router = useRouter()
  const {
    authReady,
    credentials,
    providers,
    refreshCredentials,
    refreshUser,
  } = useAppState()
  const provider = providers.find((item) => item.id === providerId) ?? null
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modelQuery, setModelQuery] = useState("")
  const authMode = providerAuthMode(provider)
  const ready = providerHasRequiredCredentials(provider, credentials)
  const providerCredentials = credentials.filter((credential) => credential.providerId === providerId)
  const {
    loading: loadingModels,
    models,
    selectedModelId,
    setSelectedModelId,
  } = useProviderModels({
    selectedProvider: provider,
    selectedProviderId: provider?.id ?? "",
    selectedProviderReady: ready,
  })
  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLocaleLowerCase("pt-BR")
    if (!needle) return models
    return models.filter((model) =>
      [model.name, model.id, ...modelCapabilityLabels(model)]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(needle)),
    )
  }, [modelQuery, models])

  if (!authReady) return <ProviderDetailSkeleton />

  if (!provider) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-3 md:p-6">
        <Button asChild variant="ghost" className="w-fit">
          <Link href="/dashboard/credentials">
            <ArrowLeftIcon data-icon="inline-start" />
            Voltar aos provedores
          </Link>
        </Button>
        <Empty className="border-border/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Provedor não encontrado</EmptyTitle>
            <EmptyDescription>Esta integração não está disponível no catálogo atual.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const activeProvider = provider

  async function handleSaveCredentials() {
    if (!provider) return
    setSaving(true)
    try {
      const result = await saveProviderCredentials(provider, credentialValues)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCredentialValues({})
      await Promise.all([refreshCredentials(), refreshUser()])
      toast.success(`${provider.label} conectado ao ModelHub.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar credenciais.")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCredentials() {
    setDeleting(true)
    try {
      for (const credential of providerCredentials) {
        await apiJsonRequest(`/user/credentials/${credential.id}`, "DELETE")
      }
      await Promise.all([refreshCredentials(), refreshUser()])
      setDeleteDialogOpen(false)
      toast.success(`Conexão com ${activeProvider.label} removida.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover conexão.")
    } finally {
      setDeleting(false)
    }
  }

  function handleUseInChat() {
    if (!selectedModelId) return
    globalThis.localStorage.setItem("selected-provider", activeProvider.id)
    globalThis.localStorage.setItem(`selected-model:${activeProvider.id}`, selectedModelId)
    router.push("/chat")
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-3 md:p-6">
      <Button asChild variant="ghost" className="w-fit">
        <Link href="/dashboard/credentials">
          <ArrowLeftIcon data-icon="inline-start" />
          Voltar aos provedores
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <ProviderAvatar
            className="rounded-2xl"
            label={provider.label}
            providerId={provider.id}
            size={58}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
                {provider.label}
              </h1>
              <Badge variant={ready ? "secondary" : "outline"}>
                {ready ? <CheckCircle2Icon data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                {ready ? "Pronto" : "Configuração necessária"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {provider.runtime?.openAiCompatible
                ? "Compatível com a API OpenAI através do gateway ModelHub."
                : "Integração nativa disponível no roteador ModelHub."}
            </p>
          </div>
        </div>
        {selectedModelId ? (
          <Button onClick={handleUseInChat}>
            <MessageSquareIcon data-icon="inline-start" />
            Usar no Chat
          </Button>
        ) : null}
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Conexão</CardTitle>
          <CardDescription>
            {authMode === "api-key"
              ? "As credenciais são criptografadas e usadas somente nas chamadas deste provedor."
              : "Esta integração não exige uma chave de API armazenada no ModelHub."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {authMode === "none" ? (
            <Alert>
              <ShieldCheckIcon />
              <AlertTitle>Nenhuma autenticação adicional</AlertTitle>
              <AlertDescription>
                O provedor está pronto para uso. As requisições passam pelo gateway seguro do ModelHub.
              </AlertDescription>
            </Alert>
          ) : null}

          {authMode === "browser-session" ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <MonitorSmartphoneIcon />
                <AlertTitle>Autenticação na sessão do navegador</AlertTitle>
                <AlertDescription>
                  A conexão é iniciada no Chat e permanece somente no navegador atual.
                </AlertDescription>
              </Alert>
              <Button asChild variant="outline" className="w-fit">
                <Link href="/chat">
                  <ExternalLinkIcon data-icon="inline-start" />
                  Abrir Chat para conectar
                </Link>
              </Button>
            </div>
          ) : null}

          {authMode === "api-key" ? (
            <div className="flex flex-col gap-5">
              {ready ? (
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>Credenciais ativas</AlertTitle>
                  <AlertDescription>
                    {providerCredentials.map((credential) => (
                      <span className="block" key={credential.id}>
                        {credential.credentialKey} · atualizada em {formatUpdatedAt(credential.updatedAt)}
                      </span>
                    ))}
                  </AlertDescription>
                </Alert>
              ) : null}

              {provider.signupUrl ? (
                <Button asChild variant="outline" className="w-fit">
                  <a href={provider.signupUrl} rel="noopener noreferrer" target="_blank">
                    <ExternalLinkIcon data-icon="inline-start" />
                    {provider.signupLabel ?? "Obter chave no provedor"}
                  </a>
                </Button>
              ) : null}

              <FieldGroup>
                {(provider.requiredKeys ?? []).map((field) => (
                  <Field key={field.envName}>
                    <FieldLabel htmlFor={field.envName}>{field.label}</FieldLabel>
                    <Input
                      autoComplete="off"
                      id={field.envName}
                      onChange={(event) => setCredentialValues((current) => ({
                        ...current,
                        [field.envName]: event.target.value,
                      }))}
                      placeholder={ready ? "Informe uma nova chave para substituir" : field.placeholder}
                      type="password"
                      value={credentialValues[field.envName] ?? ""}
                    />
                    <FieldDescription>
                      {ready
                        ? "A chave atual nunca é exibida. Salvar substitui a credencial existente."
                        : "A conexão será testada antes de a credencial ser salva."}
                    </FieldDescription>
                  </Field>
                ))}
              </FieldGroup>

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={saving} onClick={() => void handleSaveCredentials()}>
                  {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                  {saving ? "Testando conexão…" : ready ? "Substituir credenciais" : "Conectar provedor"}
                </Button>
                {providerCredentials.length > 0 ? (
                  <Button variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
                    <Trash2Icon data-icon="inline-start" />
                    Remover conexão
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Modelos disponíveis</CardTitle>
              <CardDescription>
                Escolha o modelo padrão para {provider.label}. A seleção também será usada no Chat.
              </CardDescription>
            </div>
            {models.length > 0 ? <Badge variant="outline">{models.length} modelos</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!ready ? (
            <Empty className="border-border/60">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>Conecte o provedor para carregar modelos</EmptyTitle>
                <EmptyDescription>Depois de validar as credenciais, o catálogo será carregado automaticamente.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : loadingModels ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton className="h-16 rounded-lg" key={index} />
              ))}
            </div>
          ) : models.length === 0 ? (
            <Empty className="border-border/60">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SparklesIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhum modelo retornado</EmptyTitle>
                <EmptyDescription>O provedor está conectado, mas não publicou modelos neste endpoint.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {models.length > 8 ? (
                <label className="relative block max-w-md">
                  <SearchIcon
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="sr-only">Buscar modelos</span>
                  <Input
                    className="pl-9"
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="Buscar modelo ou capacidade..."
                    type="search"
                    value={modelQuery}
                  />
                </label>
              ) : null}

              {filteredModels.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum modelo corresponde à busca.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredModels.map((model) => {
                    const selected = model.id === selectedModelId
                    const capabilities = modelCapabilityLabels(model)
                    return (
                      <Button
                        aria-pressed={selected}
                        className="h-auto min-h-16 justify-start px-3 py-3 text-left whitespace-normal"
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        variant={selected ? "default" : "outline"}
                      >
                        {selected ? <CheckCircle2Icon data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{model.name}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {capabilities.length > 0 ? capabilities.join(" · ") : model.id}
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conexão com {provider.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              As credenciais salvas serão excluídas e este provedor deixará de participar do roteamento até ser conectado novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void handleDeleteCredentials()}>
              {deleting ? "Removendo…" : "Remover conexão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
