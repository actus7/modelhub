"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import {
  type CloudDeploymentSummary,
  type CanvasDetail,
  type ProviderModel,
  type ProjectSummary,
  type UiProvider,
  MODELHUB_CONVERSATION_HEADER,
  MODELHUB_MESSAGE_HEADER,
  MODELHUB_PROJECT_HEADER,
} from "@/lib/contracts"
import {
  type AttachmentExtractionStatus,
  type AttachmentKind,
  type CanvasReferencePart,
  type ConversationAttachmentDescriptor,
  type HydratedAttachmentPart,
  type HydratedConversationMessagePart,
  createMessageContentFallback,
} from "@/lib/chat-parts"
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FrameIcon,
  KeyRoundIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MoreVerticalIcon,
  PanelRightIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  RouteIcon,
  SendHorizontalIcon,
  Settings2Icon,
  PlayIcon,
  ShareIcon,
  ShieldOffIcon,
  SparklesIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useAppState } from "@/components/app-state-provider"
import { CanvasPanel } from "@/components/canvas/canvas-panel"
import { ChatHistorySidebar } from "@/components/chat/chat-history-sidebar"
import { MessageBackstageDialog } from "@/components/chat/message-backstage-dialog"
import { SettingsDialog } from "@/components/chat/settings-dialog"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  buildExportFilename,
  conversationToJson,
  conversationToMarkdown,
  downloadTextFile,
} from "@/lib/conversation-export"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  InputGroupText,
} from "@/components/ui/input-group"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { apiFetch, apiJson, apiJsonRequest } from "@/lib/api"
import {
  createCanvas,
  getCanvas,
  listCanvases,
  listProjects,
  updateCanvas,
} from "@/lib/canvas-client"
import {
  buildDisplayText,
  CANVAS_ASSISTANT_GUIDANCE,
  detectCanvas,
  shouldRequestCanvasGuidance,
} from "@/lib/canvas-detector"
import { saveProviderCredentials } from "@/lib/save-provider-credentials"
import {
  getBrowserChatProviderAdapter,
  type BrowserProviderAuthState,
} from "@/lib/browser-chat-providers"
import { useProviderModels } from "@/lib/use-provider-models"
import {
  estimateSerializedPayloadBytes,
  formatBytes,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_DOCUMENT_ATTACHMENT_FILE_BYTES,
  MAX_SERIALIZED_CHAT_REQUEST_BYTES,
  MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  validateFileSelection,
} from "@/lib/chat-attachments"
import { parseChatStream, type ParsedToolCall } from "@/lib/chat-stream"
import {
  consumeHarnessStream,
  HarnessActiveRunError,
  HarnessRunBusyError,
} from "@/lib/harness/client"
import type { HarnessEvent } from "@/lib/harness/contracts"
import {
  providerAuthMode,
  providerCredentialIds,
  providerHasRequiredCredentials,
  providerUsesBrowserSession,
  providerUsesStoredCredentials,
  sortProvidersByConfiguredCredentials,
} from "@/lib/provider-credentials"
import { resolveMaxOutputTokens } from "@/lib/model-output-limits"
import { cn } from "@/lib/utils"
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  buildAttachmentLabel,
  buildTitleGenerationPrompt,
  buildUserMessageParts,
  DUCKAI_TEMPORARY_INLINE_MESSAGE,
  EMPTY_STATE_PROMPTS,
  formatBackstageInline,
  formatMessageTimestamp,
  getUserMessageText,
  hydrateChatMessage,
  isHydratedAttachmentPart,
  normalizeConversationTitle,
  parseApiErrorResponse,
  persistMessagesForConversation,
  releaseAttachmentPreview,
  resolveAssistantModelLabel,
  resolveModelFallbackFromHeaders,
  resolveModelSelectPlaceholder,
  resolveStickToBottom,
  resolveStreamErrorContent,
  shouldUseHarnessRuntime,
  trimConversation,
  validateAttachmentCompatibility,
  type ChatMessage,
  type ChatRequestError,
  type ComposerAttachment,
  type ConversationMessage,
  type PersistedConversationMessage,
} from "@/lib/chat-utils"

const AUTO_PROVIDER_ID = "modelhub-auto"
const AUTO_MODEL: ProviderModel = {
  capabilities: {
    documents: true,
    images: true,
    reasoning: true,
    tools: true,
  },
  id: "auto",
  name: "Auto · Smart Routing",
}

function waitForHarnessRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export function ChatPage() {
  const { credentials, providers, refreshCredentials } = useAppState()
  const [selectedProviderId, setSelectedProviderId] = useState<string>("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [input, setInput] = useState("")
  const [pending, setPending] = useState(false)
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false)
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({})
  const [savingCredentials, setSavingCredentials] = useState(false)

  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  // Conversation persistence state
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const conversationLoadRequestRef = useRef(0)

  // Temporary chat mode — messages are never persisted
  const [temporaryChat, setTemporaryChat] = useState(false)

  // Settings/personalization dialog
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [browserProviderAuthState, setBrowserProviderAuthState] =
    useState<BrowserProviderAuthState>("unknown")

  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const isMobile = useIsMobile()

  // Canvas workspace (spec v2 — fase 2)
  const [activeCanvas, setActiveCanvas] = useState<CanvasDetail | null>(null)
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false)
  const [includeCanvasContext, setIncludeCanvasContext] = useState(true)
  const [canvasWidth, setCanvasWidth] = useState(() => {
    if (typeof window === "undefined") return 420
    try {
      const stored = Number(window.localStorage.getItem("canvas-panel-width"))
      return Number.isFinite(stored) && stored >= 340 && stored <= 760
        ? stored
        : 420
    } catch {
      return 420
    }
  })
  const canvasOpenRequestRef = useRef(0)
  const canvasResizeRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )

  // Projeto ativo (contexto de projeto na conversa)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectOptions, setProjectOptions] = useState<ProjectSummary[]>([])

  function beginCanvasResize(event: React.PointerEvent) {
    event.preventDefault()
    canvasResizeRef.current = { startX: event.clientX, startWidth: canvasWidth }
    const onMove = (moveEvent: PointerEvent) => {
      const state = canvasResizeRef.current
      if (!state) return
      const next = Math.min(
        760,
        Math.max(340, state.startWidth - (moveEvent.clientX - state.startX)),
      )
      setCanvasWidth(next)
    }
    const onUp = () => {
      canvasResizeRef.current = null
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setCanvasWidth((current) => {
        try {
          window.localStorage.setItem("canvas-panel-width", String(current))
        } catch {
          // Persistência é opcional (pode estar bloqueada pelo navegador).
        }
        return current
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  function handleCanvasResizeKeyDown(event: React.KeyboardEvent) {
    let nextWidth: number | null = null
    if (event.key === "ArrowLeft") nextWidth = Math.min(760, canvasWidth + 20)
    if (event.key === "ArrowRight") nextWidth = Math.max(340, canvasWidth - 20)
    if (event.key === "Home") nextWidth = 340
    if (event.key === "End") nextWidth = 760
    if (nextWidth === null) return

    event.preventDefault()
    setCanvasWidth(nextWidth)
    try {
      window.localStorage.setItem("canvas-panel-width", String(nextWidth))
    } catch {
      // Persistência é opcional (pode estar bloqueada pelo navegador).
    }
  }

  function loadProjectOptions() {
    listProjects()
      .then(setProjectOptions)
      .catch(() => {
        // silencioso — seletor mostra apenas "Sem projeto"
      })
  }

  async function openCanvasById(canvasId: string) {
    const requestId = ++canvasOpenRequestRef.current
    try {
      const canvas = await getCanvas(canvasId)
      if (requestId !== canvasOpenRequestRef.current) return
      setActiveCanvas(canvas)
      setCanvasPanelOpen(true)
    } catch {
      if (requestId === canvasOpenRequestRef.current) {
        toast.error("Falha ao abrir o canvas.")
      }
    }
  }

  // Stop generation
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeGenerationIdRef = useRef<string | null>(null)
  const activeHarnessRunIdRef = useRef<string | null>(null)

  const cancelActiveGeneration = useCallback(() => {
    const runId = activeHarnessRunIdRef.current
    activeHarnessRunIdRef.current = null
    activeGenerationIdRef.current = null
    const controller = abortControllerRef.current
    abortControllerRef.current = null
    controller?.abort()
    setPending(false)
    if (runId) {
      void apiJsonRequest(`/harness/agent-runs/${runId}/cancel`, "POST")
        .catch((error) => {
          console.error("[harness] falha ao cancelar execução", error)
        })
    }
  }, [])

  useEffect(() => {
    return () => {
      const runId = activeHarnessRunIdRef.current
      activeHarnessRunIdRef.current = null
      activeGenerationIdRef.current = null
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      if (runId) {
        void apiFetch(`/harness/agent-runs/${runId}/cancel`, {
          keepalive: true,
          method: "POST",
        })
      }
    }
  }, [])

  // Smart auto-scroll: só acompanha o fim enquanto o usuário não rolar para cima
  const stickToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  // Copy message feedback
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)

  // Message reactions
  const [reactions, setReactions] = useState<Record<string, string | null>>({})
  const [reactionNotes, setReactionNotes] = useState<Record<string, string>>({})

  // Bastidores da resposta (roteamento, fallback, tempo, tokens de uma resposta)
  const [backstageOpenMessageId, setBackstageOpenMessageId] = useState<
    string | null
  >(null)

  // Edit message
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState("")

  // File attachments
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Dynamic OpenClaw destinations: every healthy OpenClaw deployment with a
  // managed config becomes a virtual provider whose base points at the chat-proxy endpoint.
  const [openclawDeployments, setOpenclawDeployments] = useState<
    CloudDeploymentSummary[]
  >([])

  useEffect(() => {
    let cancelled = false
    apiJson<{ deployments: CloudDeploymentSummary[] }>(
      "/user/cloud/deployments",
    )
      .then((payload) => {
        if (cancelled) return
        setOpenclawDeployments(
          payload.deployments.filter(
            (d) => d.status === "healthy" && d.openclaw,
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setOpenclawDeployments([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const searchParams = useSearchParams()
  useEffect(() => {
    const openclawId = searchParams.get("openclaw")
    if (openclawId) {
      const targetProviderId = `openclaw:${openclawId}`
      const exists = openclawDeployments.some((d) => d.id === openclawId)
      if (exists) {
        setSelectedProviderId(targetProviderId)
        const url = new URL(window.location.href)
        url.searchParams.delete("openclaw")
        window.history.replaceState({}, "", url.toString())
      }
    }

    // ?project=<id>&new=1 — nova conversa vinculada ao projeto (spec v2)
    const projectId = searchParams.get("project")
    if (projectId) {
      setActiveProjectId(projectId)
      if (searchParams.get("new") === "1") {
        attachmentsRef.current.forEach(releaseAttachmentPreview)
        setActiveConversationId(null)
        setMessages([])
        setConversation([])
        setInput("")
        setAttachments([])
        setActiveCanvas(null)
        setCanvasPanelOpen(false)
      }
      const url = new URL(window.location.href)
      url.searchParams.delete("project")
      url.searchParams.delete("new")
      window.history.replaceState({}, "", url.toString())
    }
  }, [searchParams, openclawDeployments])

  // Carrega opções de projeto para o seletor do composer (uma vez)
  useEffect(() => {
    loadProjectOptions()
  }, [])

  const autoProvider = useMemo<UiProvider>(
    () => ({
      base: "/v1",
      category: "gateway",
      hasModels: true,
      id: AUTO_PROVIDER_ID,
      label: "ModelHub",
      localModels: [AUTO_MODEL],
      runtime: {
        authMode: "none",
        externalApi: false,
        kind: "server",
        openAiCompatible: true,
        transport: "openai-compatible",
      },
    }),
    [],
  )

  const openclawProviders = useMemo<UiProvider[]>(() => {
    const providerLabels = new Map(
      providers.map((provider) => [provider.id, provider.label]),
    )

    return openclawDeployments.flatMap((deployment) => {
      const openclaw = deployment.openclaw
      if (!openclaw) return []

      const providerLabel =
        providerLabels.get(openclaw.provider) ?? openclaw.provider

      return [
        {
          base: `/user/cloud/deployments/${deployment.id}`,
          hasModels: true,
          id: `openclaw:${deployment.id}`,
          label: `OpenClaw · ${deployment.name}`,
          localModels: [
            {
              capabilities: { documents: true, images: false },
              id: openclaw.model,
              name: `${providerLabel} · ${openclaw.model}`,
            },
          ],
          runtime: {
            authMode: "none",
            externalApi: false,
            kind: "server",
            openAiCompatible: true,
            transport: "modelhub-proxy",
          },
        },
      ]
    })
  }, [openclawDeployments, providers])

  const selectedProvider = useMemo(
    () =>
      [autoProvider, ...providers, ...openclawProviders].find(
        (provider) => provider.id === selectedProviderId,
      ) ?? null,
    [autoProvider, providers, openclawProviders, selectedProviderId],
  )
  const browserProviderAdapter = useMemo(
    () => getBrowserChatProviderAdapter(selectedProviderId),
    [selectedProviderId],
  )
  const providersWithoutApiKey = useMemo(
    () => providers.filter((provider) => providerAuthMode(provider) === "none"),
    [providers],
  )
  const providersWithBrowserSession = useMemo(
    () => providers.filter(providerUsesBrowserSession),
    [providers],
  )
  const providersWithApiKey = useMemo(
    () =>
      sortProvidersByConfiguredCredentials(
        providers.filter(providerUsesStoredCredentials),
        credentials,
      ),
    [credentials, providers],
  )
  const configuredProvidersWithApiKey = useMemo(
    () =>
      providersWithApiKey.filter((provider) =>
        providerHasRequiredCredentials(provider, credentials),
      ),
    [credentials, providersWithApiKey],
  )
  const unconfiguredProvidersWithApiKey = useMemo(
    () =>
      providersWithApiKey.filter(
        (provider) => !providerHasRequiredCredentials(provider, credentials),
      ),
    [credentials, providersWithApiKey],
  )
  const selectedProviderReady = providerHasRequiredCredentials(
    selectedProvider,
    credentials,
  )
  const providerModels = useProviderModels({
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  })
  const { models, selectedModel, selectedModelId, setSelectedModelId } =
    providerModels
  const loadingModels = providerModels.loading

  const showConfiguredCheck = useCallback(
    (provider: UiProvider) => {
      if (providerUsesStoredCredentials(provider)) {
        return providerHasRequiredCredentials(provider, credentials)
      }
      return false
    },
    [credentials],
  )

  const refreshBrowserProviderAuthState = useCallback(async () => {
    if (!browserProviderAdapter) {
      setBrowserProviderAuthState("unknown")
      return
    }

    setBrowserProviderAuthState("loading")
    try {
      setBrowserProviderAuthState(await browserProviderAdapter.auth.getState())
    } catch {
      setBrowserProviderAuthState("signed-out")
    }
  }, [browserProviderAdapter])

  async function handleBrowserProviderSignIn() {
    if (!browserProviderAdapter || !selectedProvider) {
      return
    }

    setBrowserProviderAuthState("loading")
    try {
      await browserProviderAdapter.auth.signIn()
      setBrowserProviderAuthState("signed-in")
      toast.success(`${selectedProvider.label} conectado.`)
    } catch (error) {
      setBrowserProviderAuthState("signed-out")
      toast.error(
        error instanceof Error
          ? error.message
          : `Nao foi possivel entrar em ${selectedProvider.label}.`,
      )
    }
  }

  const allowImageAttachments = selectedModel?.capabilities.images ?? false
  const allowDocumentAttachments = selectedModel?.capabilities.documents ?? true
  const composerHasUploadingAttachments = attachments.some(
    (attachment) => attachment.status === "uploading",
  )

  useEffect(() => {
    if (providers.length === 0 || selectedProviderId) {
      return
    }

    const preferred =
      globalThis.window?.localStorage.getItem("selected-provider") ??
      AUTO_PROVIDER_ID
    setSelectedProviderId(preferred)
  }, [providers, selectedProviderId])

  useEffect(() => {
    if (!selectedProviderId || typeof globalThis === "undefined") {
      return
    }

    globalThis.localStorage.setItem("selected-provider", selectedProviderId)
  }, [selectedProviderId])

  useEffect(() => {
    if (!browserProviderAdapter) {
      setBrowserProviderAuthState("unknown")
      return
    }

    void refreshBrowserProviderAuthState()
  }, [browserProviderAdapter, refreshBrowserProviderAuthState])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(releaseAttachmentPreview)
    }
  }, [])

  // Smart auto-scroll: scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    if (stickToBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      // Mantém a referência em dia para que o `scroll` disparado por esta
      // escrita não seja lido como rolagem do usuário.
      lastScrollTopRef.current = viewport.scrollTop
    }
  }, [messages])

  // Detect if user scrolled up
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      stickToBottomRef.current = resolveStickToBottom({
        clientHeight: viewport.clientHeight,
        previousScrollTop: lastScrollTopRef.current,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
        sticking: stickToBottomRef.current,
      })
      lastScrollTopRef.current = viewport.scrollTop
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [])

  async function saveCredentials() {
    if (!selectedProvider) {
      return
    }

    const requiredKeys = selectedProvider.requiredKeys ?? []
    if (
      requiredKeys.some((field) => !credentialValues[field.envName]?.trim())
    ) {
      toast.error("Preencha todas as credenciais do provider.")
      return
    }

    setSavingCredentials(true)
    try {
      const result = await saveProviderCredentials(
        selectedProvider,
        credentialValues,
      )
      if (!result.ok) {
        toast.error(result.error)
        return
      }

      await refreshCredentials()
      setCredentialDialogOpen(false)
      setCredentialValues({})
      toast.success(`Credenciais salvas para ${selectedProvider.label}.`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar credenciais.",
      )
    } finally {
      setSavingCredentials(false)
    }
  }

  async function clearCredentials() {
    if (!selectedProvider) {
      return
    }

    try {
      const ids = providerCredentialIds(selectedProvider.id, credentials)
      await Promise.all(
        ids.map((id) => apiJsonRequest(`/user/credentials/${id}`, "DELETE")),
      )
      await refreshCredentials()
      setCredentialDialogOpen(false)
      toast.success(`Credenciais removidas de ${selectedProvider.label}.`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao limpar credenciais.",
      )
    }
  }

  async function ensureConversationId(titleSeed: string) {
    if (activeConversationId) {
      return activeConversationId
    }

    const response = await apiJsonRequest<{
      conversation: { id: string }
    }>("/conversations", "POST", {
      modelId: selectedModelId || undefined,
      projectId: activeProjectId ?? undefined,
      providerId: selectedProviderId || undefined,
      title: normalizeConversationTitle(titleSeed),
    })

    setActiveConversationId(response.conversation.id)
    setSidebarRefreshKey((current) => current + 1)
    return response.conversation.id
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || !selectedProvider) return

    if (!selectedProviderReady) {
      setCredentialDialogOpen(true)
      return
    }

    if (selectedProvider.hasModels && !selectedModelId) {
      toast.error("Selecione um modelo antes de anexar arquivos.")
      return
    }

    const { accepted, errors } = validateFileSelection(
      Array.from(files),
      attachments.map((attachment) => ({
        kind: attachment.kind,
        size: attachment.byteSize,
      })),
      {
        allowImages: allowImageAttachments,
        allowDocuments: allowDocumentAttachments,
      },
    )
    errors.forEach((message) => toast.error(message))

    const uploadQueue: Array<{
      file: File
      kind: AttachmentKind
      previewUrl?: string
    }> = accepted.map(({ file, kind }) => ({
      file,
      kind,
      previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
    }))

    if (uploadQueue.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    let conversationId: string
    try {
      conversationId = await ensureConversationId(
        input.trim() || uploadQueue[0]?.file.name || "Nova conversa",
      )
    } catch (error) {
      uploadQueue.forEach((entry) => {
        if (entry.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(entry.previewUrl)
        }
      })
      toast.error(
        error instanceof Error
          ? error.message
          : "Falha ao preparar a conversa para upload.",
      )
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    const tempAttachments = uploadQueue.map(({ file, kind, previewUrl }) => ({
      byteSize: file.size,
      contentUrl: "",
      extractionStatus: "processing" as AttachmentExtractionStatus,
      fileName: file.name,
      id: crypto.randomUUID(),
      kind,
      mimeType: file.type,
      previewUrl,
      status: "uploading" as const,
    }))

    setAttachments((current) => [...current, ...tempAttachments])

    for (const [index, tempAttachment] of tempAttachments.entries()) {
      const source = uploadQueue[index]
      if (!source) {
        continue
      }

      try {
        const formData = new FormData()
        formData.append("file", source.file)
        const uploaded = await apiJson<{
          attachment: ConversationAttachmentDescriptor
        }>(`/conversations/${conversationId}/attachments`, {
          body: formData,
          method: "POST",
        })

        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === tempAttachment.id
              ? {
                  ...uploaded.attachment,
                  previewUrl: tempAttachment.previewUrl,
                  status: "uploaded",
                }
              : attachment,
          ),
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Falha ao enviar ${tempAttachment.fileName}.`,
        )
        setAttachments((current) => {
          const target = current.find(
            (attachment) => attachment.id === tempAttachment.id,
          )
          if (target) {
            releaseAttachmentPreview(target)
          }
          return current.filter(
            (attachment) => attachment.id !== tempAttachment.id,
          )
        })
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id)
      if (target) {
        releaseAttachmentPreview(target)
      }
      return prev.filter((attachment) => attachment.id !== id)
    })
  }

  const handleNewChat = useCallback(() => {
    conversationLoadRequestRef.current += 1
    canvasOpenRequestRef.current += 1
    cancelActiveGeneration()
    attachmentsRef.current.forEach(releaseAttachmentPreview)
    setActiveConversationId(null)
    setMessages([])
    setConversation([])
    setInput("")
    setEditingMessageId(null)
    setAttachments([])
    setTemporaryChat(false)
    setActiveCanvas(null)
    setCanvasPanelOpen(false)
  }, [cancelActiveGeneration])

  // Stop generation
  const handleStopGeneration = useCallback(() => {
    cancelActiveGeneration()
  }, [cancelActiveGeneration])

  // Copy message content
  const handleCopyMessage = useCallback(
    (messageId: string, content: string) => {
      void navigator.clipboard.writeText(content).then(() => {
        setCopiedMessageId(messageId)
        setTimeout(() => setCopiedMessageId(null), 2000)
      })
    },
    [],
  )

  // Toggle reaction on a message
  async function handleReaction(
    messageId: string,
    type: "thumbs_up" | "thumbs_down",
  ) {
    if (!activeConversationId) return
    const current = reactions[messageId]
    // Optimistic update
    setReactions((prev) => ({
      ...prev,
      [messageId]: current === type ? null : type,
    }))
    try {
      await apiJsonRequest(
        `/conversations/${activeConversationId}/messages/${messageId}/reaction`,
        "POST",
        { type },
      )
    } catch {
      // Revert on failure
      setReactions((prev) => ({ ...prev, [messageId]: current ?? null }))
    }
  }

  // Salva a nota do thumbs-down (mantém a reação, só atualiza o texto)
  async function handleSaveReactionNote(messageId: string) {
    if (!activeConversationId) return
    const note = reactionNotes[messageId] ?? ""
    try {
      await apiJsonRequest(
        `/conversations/${activeConversationId}/messages/${messageId}/reaction`,
        "POST",
        { note, type: "thumbs_down" },
      )
    } catch {
      // Silencioso — a nota fica só no estado local se a chamada falhar.
    }
  }

  const handleSelectConversation = useCallback(
    async (id: string) => {
      const requestId = ++conversationLoadRequestRef.current
      canvasOpenRequestRef.current += 1
      cancelActiveGeneration()
      setActiveCanvas(null)
      try {
        const data = await apiJson<{
          messages: PersistedConversationMessage[]
          conversation: {
            providerId: string | null
            modelId: string | null
            projectId: string | null
          }
        }>(`/conversations/${id}/messages`)
        if (requestId !== conversationLoadRequestRef.current) return
        const persistedAssistantModelLabel = resolveAssistantModelLabel({
          modelId: data.conversation.modelId ?? undefined,
          models: [],
          providerLabel: providers.find(
            (provider) => provider.id === data.conversation.providerId,
          )?.label,
        })

        attachmentsRef.current.forEach(releaseAttachmentPreview)
        setActiveConversationId(id)
        setAttachments([])
        setActiveProjectId(data.conversation.projectId ?? null)
        setMessages(
          data.messages.map((message) =>
            hydrateChatMessage({
              assistantModelLabel: persistedAssistantModelLabel,
              message,
            }),
          ),
        )
        setConversation(
          data.messages.map((message) => ({
            id: message.id,
            parts: message.parts,
            role: message.role,
          })),
        )

        // Abre o canvas mais recente da conversa (se houver) sem forçar foco.
        listCanvases(id)
          .then((canvases) => {
            if (canvases.length > 0) {
              return getCanvas(canvases[0]!.id)
            }
            return null
          })
          .then((canvas) => {
            if (requestId === conversationLoadRequestRef.current && canvas) {
              setActiveCanvas(canvas)
            }
          })
          .catch(() => {
            // Canvas é opcional ao abrir conversa
          })

        // Restore provider/model if available
        if (data.conversation.providerId) {
          setSelectedProviderId(data.conversation.providerId)
        }
        if (data.conversation.modelId) {
          setSelectedModelId(data.conversation.modelId)
        }
      } catch {
        if (requestId === conversationLoadRequestRef.current) {
          toast.error("Falha ao carregar conversa.")
        }
      }
    },
    [cancelActiveGeneration, providers, setSelectedModelId],
  )

  function updateAssistantToolCall(
    assistantMessageId: string,
    toolCall: ParsedToolCall,
  ) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== assistantMessageId) {
          return message
        }

        const existingIndex = message.toolCalls.findIndex(
          (item) => item.toolCallId === toolCall.toolCallId,
        )
        if (existingIndex === -1) {
          return {
            ...message,
            toolCalls: [...message.toolCalls, toolCall],
          }
        }

        const nextToolCalls = [...message.toolCalls]
        nextToolCalls[existingIndex] = {
          ...nextToolCalls[existingIndex],
          ...toolCall,
        }
        return {
          ...message,
          toolCalls: nextToolCalls,
        }
      }),
    )
  }

  async function handleHarnessApproval(
    assistantMessageId: string,
    toolCall: ParsedToolCall,
    decision: "approved" | "denied",
  ) {
    if (!toolCall.approvalId || pending) return
    const controller = new AbortController()
    const generationId = crypto.randomUUID()
    activeGenerationIdRef.current = generationId
    abortControllerRef.current = controller
    setPending(true)
    updateAssistantToolCall(assistantMessageId, {
      ...toolCall,
      status: "running",
    })

    try {
      const resolved = await apiJsonRequest<{
        result: unknown
        runId: string
        status: string
      }>(`/harness/tool-approvals/${toolCall.approvalId}/resolve`, "POST", {
        decision,
      })
      updateAssistantToolCall(assistantMessageId, {
        ...toolCall,
        result: resolved.result,
        status: "completed",
      })
      if (resolved.status !== "yielded") {
        setSidebarRefreshKey((key) => key + 1)
        return
      }
      const continuationTools = new Map<string, ParsedToolCall>([
        [
          toolCall.toolCallId,
          { ...toolCall, result: resolved.result, status: "completed" },
        ],
      ])
      let runId = resolved.runId
      activeHarnessRunIdRef.current = runId
      let finalMessageId: string | undefined
      let finalContent = ""
      let finalRunStatus = resolved.status

      for (let continuation = 0; continuation < 128; continuation++) {
        const response = await apiFetch(
          `/harness/agent-runs/${runId}/continue`,
          { method: "POST", signal: controller.signal },
        )
        const responseRunId = response.headers.get("x-modelhub-run-id")
        if (responseRunId && activeGenerationIdRef.current === generationId) {
          activeHarnessRunIdRef.current = responseRunId
        }
        let result: Awaited<ReturnType<typeof consumeHarnessStream>>
        try {
          result = await consumeHarnessStream(response, (event) => {
            if (activeGenerationIdRef.current !== generationId) return
            if (event.runId) activeHarnessRunIdRef.current = event.runId
            if (
              event.type === "run/status" &&
              ["cancelled", "completed", "failed", "waiting_approval"].includes(
                String(event.payload.status ?? ""),
              )
            ) {
              activeHarnessRunIdRef.current = null
            }
            if (
              event.type === "assistant/chunk" &&
              event.payload.live === true &&
              typeof event.payload.delta === "string"
            ) {
              finalContent += event.payload.delta
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: `${message.content}${event.payload.delta as string}`,
                      }
                    : message,
                ),
              )
            }
            if (event.type === "tool/call") {
              const call: ParsedToolCall = {
                args: event.payload.args ?? {},
                status: "running",
                toolCallId: String(event.payload.toolCallId ?? ""),
                toolName: String(event.payload.toolName ?? "unknown_tool"),
              }
              continuationTools.set(call.toolCallId, call)
              updateAssistantToolCall(assistantMessageId, call)
            }
            if (event.type === "tool/approval-required") {
              const toolCallId = String(event.payload.toolCallId ?? "")
              const previous = continuationTools.get(toolCallId)
              const call: ParsedToolCall = {
                approvalId: String(event.payload.approvalId ?? ""),
                args: event.payload.args ?? previous?.args ?? {},
                requiresApproval: true,
                status: "pending-approval",
                toolCallId,
                toolName: String(
                  event.payload.toolName ?? previous?.toolName ?? "unknown_tool",
                ),
              }
              continuationTools.set(toolCallId, call)
              updateAssistantToolCall(assistantMessageId, call)
            }
            if (event.type === "tool/result") {
              const toolCallId = String(event.payload.toolCallId ?? "")
              const previous = continuationTools.get(toolCallId)
              if (!previous) return
              const call: ParsedToolCall = {
                ...previous,
                result: event.payload.result ?? null,
                status: "completed",
              }
              continuationTools.set(toolCallId, call)
              updateAssistantToolCall(assistantMessageId, call)
            }
            if (
              event.type === "assistant/message" &&
              typeof event.payload.content === "string"
            ) {
              finalContent = event.payload.content
            }
          })
        } catch (error) {
          if (error instanceof HarnessRunBusyError) {
            runId = error.runId
            activeHarnessRunIdRef.current = error.runId
            await waitForHarnessRetry(
              Math.min(Math.max(error.retryAfterMs ?? 1_000, 500), 5_000),
              controller.signal,
            )
            continue
          }
          throw error
        }
        finalMessageId = result.assistantMessageId ?? finalMessageId
        runId = result.runId ?? responseRunId ?? runId
        finalRunStatus = result.status
        if (!["running", "yielded"].includes(result.status)) break
        if (result.status === "running") {
          await waitForHarnessRetry(750, controller.signal)
        }
      }

      if (["queued", "running", "yielded"].includes(finalRunStatus)) {
        throw new Error("A geração não atingiu um estado terminal após várias tentativas de reconexão.")
      }

      if (finalMessageId) {
        let projectedContent = finalContent
        let projectedParts: HydratedConversationMessagePart[] = [
          { text: finalContent, type: "text" },
        ]
        const suggestion = detectCanvas(finalContent)
        if (suggestion && activeConversationId) {
          try {
            const activeInConversation =
              activeCanvas?.conversationId === activeConversationId
            const canvas = activeInConversation
              ? await updateCanvas(activeCanvas.id, {
                  content: suggestion.content,
                  kind: suggestion.kind,
                  language: suggestion.language,
                })
              : await createCanvas(activeConversationId, {
                  content: suggestion.content,
                  kind: suggestion.kind,
                  language: suggestion.language,
                  title: suggestion.title,
                })
            setActiveCanvas(canvas)
            setCanvasPanelOpen(true)
            projectedContent = buildDisplayText(finalContent, suggestion)
            const canvasPart: CanvasReferencePart = {
              canvasId: canvas.id,
              kind: canvas.kind,
              title: canvas.title,
              type: "canvas",
            }
            projectedParts = projectedContent
              ? [{ text: projectedContent, type: "text" }, canvasPart]
              : [canvasPart]
          } catch (error) {
            console.error("[harness] falha ao projetar canvas", error)
          }
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: projectedContent,
                  id: finalMessageId,
                  parts: projectedParts,
                }
              : message,
          ),
        )
        setConversation((current) => {
          const existingIndex = current.findIndex(
            (message) => message.id === assistantMessageId,
          )
          if (existingIndex === -1) {
            return [
              ...current,
              {
                id: finalMessageId,
                parts: projectedParts,
                role: "assistant" as const,
              },
            ]
          }
          return current.map((message, index) =>
            index === existingIndex
              ? {
                  id: finalMessageId,
                  parts: projectedParts,
                  role: "assistant" as const,
                }
              : message,
          )
        })
        if (activeConversationId) {
          await apiJsonRequest(
            `/harness/conversations/${activeConversationId}/messages/${finalMessageId}/projection`,
            "PATCH",
            { content: projectedContent, parts: projectedParts },
          ).catch((error) => {
            console.error("[harness] falha ao atualizar projeção", error)
          })
        }
      }
      setSidebarRefreshKey((key) => key + 1)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Falha ao resolver aprovação.",
        )
        updateAssistantToolCall(assistantMessageId, toolCall)
      }
    } finally {
      if (activeGenerationIdRef.current === generationId) {
        activeGenerationIdRef.current = null
        activeHarnessRunIdRef.current = null
        setPending(false)
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  async function sendMessage(options?: {
    baseConversation?: ConversationMessage[]
    overrideAttachments?: HydratedAttachmentPart[]
    overrideText?: string
  }) {
    const text = (options?.overrideText ?? input).trim()
    const currentAttachments =
      options?.overrideAttachments ??
      attachments
        .filter((attachment) => attachment.status === "uploaded")
        .map((attachment) => ({
          ...attachment,
          attachmentId: attachment.id,
          type: "attachment" as const,
        }))
    const hasAttachments = currentAttachments.length > 0
    const hasPendingComposerAttachments = attachments.some(
      (attachment) => attachment.status === "uploading",
    )
    if ((!text && !hasAttachments) || pending || !selectedProvider) {
      return
    }

    if (!options?.overrideAttachments && hasPendingComposerAttachments) {
      toast.error("Aguarde o processamento dos anexos antes de enviar.")
      return
    }

    if (!selectedProviderReady) {
      setCredentialDialogOpen(true)
      return
    }

    if (selectedProvider.hasModels && !selectedModelId) {
      toast.error("Selecione um modelo.")
      return
    }

    const compatibilityError = validateAttachmentCompatibility(
      currentAttachments,
      {
        allowImages: allowImageAttachments,
        allowDocuments: allowDocumentAttachments,
      },
      selectedProvider.label,
      browserProviderAdapter?.attachments,
    )
    if (compatibilityError) {
      toast.error(compatibilityError)
      return
    }

    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const assistantModelLabel = resolveAssistantModelLabel({
      modelId: selectedProvider.hasModels ? selectedModelId : undefined,
      models,
      providerLabel: selectedProvider.label,
    })

    const messageParts = buildUserMessageParts(
      text,
      currentAttachments.map((attachment) => ({
        byteSize: attachment.byteSize,
        contentUrl: attachment.contentUrl,
        extractionStatus: attachment.extractionStatus,
        fileName: attachment.fileName,
        id: attachment.attachmentId,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
      })),
    )
    const baseConversation = options?.baseConversation ?? conversation
    const nextConversation: ConversationMessage[] = [
      ...baseConversation,
      {
        id: userMessageId,
        parts: messageParts,
        role: "user" as const,
      },
    ]

    // Contexto do canvas ativo (spec: role user prefixada, cap 20k, não persiste/não aparece na UI)
    const canvasContextMessage: ConversationMessage | null =
      activeCanvas && canvasPanelOpen && includeCanvasContext
        ? {
            id: crypto.randomUUID(),
            parts: [
              {
                text: `[canvas ativo: ${activeCanvas.title}]\n${activeCanvas.content.slice(0, 20_000)}`,
                type: "text" as const,
              },
            ],
            role: "user" as const,
          }
        : null
    // Intenção explícita de canvas: instrui o modelo a produzir formato elegível
    const canvasIntent = shouldRequestCanvasGuidance(text)
    const canvasGuidanceMessage: ConversationMessage | null = canvasIntent
      ? {
          id: crypto.randomUUID(),
          parts: [{ text: CANVAS_ASSISTANT_GUIDANCE, type: "text" as const }],
          role: "user" as const,
        }
      : null
    const contextualPrepend: ConversationMessage[] = [
      ...(canvasGuidanceMessage ? [canvasGuidanceMessage] : []),
      ...(canvasContextMessage ? [canvasContextMessage] : []),
    ]
    const messagesToSend: ConversationMessage[] =
      contextualPrepend.length > 0
        ? [
            ...nextConversation.slice(0, -1),
            ...contextualPrepend,
            nextConversation.at(-1)!,
          ]
        : nextConversation
    const projectHeaders: Record<string, string> = activeProjectId
      ? { [MODELHUB_PROJECT_HEADER]: activeProjectId }
      : {}
    const backstageHeaders: Record<string, string> = {
      ...(activeConversationId
        ? { [MODELHUB_CONVERSATION_HEADER]: activeConversationId }
        : {}),
      [MODELHUB_MESSAGE_HEADER]: assistantMessageId,
    }

    const maxOutputTokens = resolveMaxOutputTokens({
      model: selectedModel,
      modelId: selectedModelId,
      providerId: selectedProvider.id,
    })
    const requestPayload = {
      id: crypto.randomUUID(),
      max_tokens: maxOutputTokens,
      messages: messagesToSend,
      modelId: selectedProvider.hasModels ? selectedModelId : undefined,
      trigger: "submit-message",
    }

    const estimatedPayloadBytes = estimateSerializedPayloadBytes(requestPayload)
    if (estimatedPayloadBytes > MAX_SERIALIZED_CHAT_REQUEST_BYTES) {
      toast.error(
        `Mensagem muito grande para o runtime serverless. Reduza texto/anexos para ficar abaixo de ${formatBytes(MAX_SERIALIZED_CHAT_REQUEST_BYTES)} por request.`,
      )
      return
    }

    setConversation(nextConversation)
    setMessages((current) => [
      ...(options?.baseConversation
        ? current.slice(0, options.baseConversation.length)
        : current),
      {
        content: text,
        createdAt: new Date().toISOString(),
        id: userMessageId,
        parts: messageParts,
        role: "user",
        toolCalls: [],
      },
      {
        content: "",
        createdAt: new Date().toISOString(),
        id: assistantMessageId,
        modelLabel: assistantModelLabel,
        role: "assistant",
        toolCalls: [],
      },
    ])
    if (!options?.overrideAttachments) {
      attachmentsRef.current.forEach(releaseAttachmentPreview)
      setInput("")
      setAttachments([])
    }
    setPending(true)
    stickToBottomRef.current = true

    const controller = new AbortController()
    const generationId = crypto.randomUUID()
    activeGenerationIdRef.current = generationId
    activeHarnessRunIdRef.current = null
    abortControllerRef.current = controller

    try {
      let fullText = ""
      let effectiveModelLabel = assistantModelLabel
      let harnessPersisted = false
      let harnessConversationId: string | null = null
      let harnessAssistantMessageId: string | undefined
      let harnessRunStatus: string | undefined
      if (browserProviderAdapter) {
        if (browserProviderAuthState !== "signed-in") {
          setBrowserProviderAuthState("loading")
          await browserProviderAdapter.auth.signIn()
          setBrowserProviderAuthState("signed-in")
        }

        fullText = await browserProviderAdapter.stream({
          conversationMessages: messagesToSend,
          modelId: selectedModelId,
          projectId: activeProjectId ?? undefined,
          signal: controller.signal,
          onTextDelta(delta) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            )
          },
        })
        setBrowserProviderAuthState("signed-in")
      } else if (
        shouldUseHarnessRuntime({
          supportsTools: selectedModel?.capabilities.tools === true,
          temporaryChat,
        })
      ) {
        harnessConversationId = await ensureConversationId(
          (text || currentAttachments[0]?.fileName || "Nova conversa").slice(
            0,
            200,
          ),
        )
        harnessPersisted = true
        const harnessModel =
          selectedProviderId === AUTO_PROVIDER_ID
            ? selectedModelId
            : `${selectedProvider.id}/${selectedModelId}`
        const toolMap = new Map<string, ParsedToolCall>()
        let endpoint = `/harness/conversations/${harnessConversationId}/turns`
        let requestBody: Record<string, unknown> | undefined = {
          // Contextual canvas/project snapshots influence this request but are
          // intentionally not durable user turns in the event log.
          enteredMessages: [nextConversation.at(-1)!],
          idempotencyKey: crypto.randomUUID(),
          maxSteps: 16,
          messages: messagesToSend,
          model: harnessModel,
          projectId: activeProjectId ?? undefined,
        }

        for (let continuation = 0; continuation < 128; continuation++) {
          const response = await apiFetch(endpoint, {
            body: requestBody ? JSON.stringify(requestBody) : undefined,
            headers: {
              "Content-Type": "application/json",
              ...projectHeaders,
              ...backstageHeaders,
            },
            method: "POST",
            signal: controller.signal,
          })
          const responseRunId = response.headers.get("x-modelhub-run-id")
          if (responseRunId && activeGenerationIdRef.current === generationId) {
            activeHarnessRunIdRef.current = responseRunId
          }
          let result: Awaited<ReturnType<typeof consumeHarnessStream>>
          try {
            result = await consumeHarnessStream(
              response,
              (event: HarnessEvent) => {
              if (activeGenerationIdRef.current !== generationId) return
              if (event.runId) activeHarnessRunIdRef.current = event.runId
              if (
                event.type === "run/status" &&
                ["cancelled", "completed", "failed", "waiting_approval"].includes(
                  String(event.payload.status ?? ""),
                )
              ) {
                activeHarnessRunIdRef.current = null
              }
              if (
                event.type === "assistant/chunk" &&
                event.payload.live === true &&
                typeof event.payload.delta === "string"
              ) {
                setMessages((current) =>
                  current.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          content: `${message.content}${event.payload.delta as string}`,
                        }
                      : message,
                  ),
                )
              }
              if (event.type === "tool/call") {
                const call: ParsedToolCall = {
                  args: event.payload.args ?? {},
                  status: "running",
                  toolCallId: String(event.payload.toolCallId ?? ""),
                  toolName: String(event.payload.toolName ?? "unknown_tool"),
                }
                toolMap.set(call.toolCallId, call)
                updateAssistantToolCall(assistantMessageId, call)
              }
              if (event.type === "tool/approval-required") {
                const toolCallId = String(event.payload.toolCallId ?? "")
                const previous = toolMap.get(toolCallId)
                const call: ParsedToolCall = {
                  args: event.payload.args ?? previous?.args ?? {},
                  approvalId: String(event.payload.approvalId ?? ""),
                  requiresApproval: true,
                  status: "pending-approval",
                  toolCallId,
                  toolName: String(
                    event.payload.toolName ?? previous?.toolName ?? "unknown_tool",
                  ),
                }
                toolMap.set(toolCallId, call)
                updateAssistantToolCall(assistantMessageId, call)
              }
              if (event.type === "tool/result") {
                const toolCallId = String(event.payload.toolCallId ?? "")
                const previous = toolMap.get(toolCallId)
                if (previous) {
                  const call: ParsedToolCall = {
                    ...previous,
                    result: event.payload.result ?? null,
                    status: "completed",
                  }
                  toolMap.set(toolCallId, call)
                  updateAssistantToolCall(assistantMessageId, call)
                }
              }
              if (
                event.type === "assistant/message" &&
                typeof event.payload.modelLabel === "string"
              ) {
                effectiveModelLabel = event.payload.modelLabel
              }
              },
            )
          } catch (error) {
            if (error instanceof HarnessRunBusyError) {
              activeHarnessRunIdRef.current = error.runId
              endpoint = `/harness/agent-runs/${error.runId}/continue`
              requestBody = undefined
              await waitForHarnessRetry(
                Math.min(Math.max(error.retryAfterMs ?? 1_000, 500), 5_000),
                controller.signal,
              )
              continue
            }
            throw error
          }
          fullText = result.replaceText ? result.text : `${fullText}${result.text}`
          const resultRunId = result.runId ?? responseRunId ?? undefined
          harnessAssistantMessageId =
            result.assistantMessageId ?? harnessAssistantMessageId
          harnessRunStatus = result.status
          if (
            !["running", "yielded"].includes(result.status) ||
            !resultRunId
          ) break
          endpoint = `/harness/agent-runs/${resultRunId}/continue`
          requestBody = undefined
          if (result.status === "running") {
            await waitForHarnessRetry(750, controller.signal)
          }
        }
        if (
          harnessRunStatus &&
          ["queued", "running", "yielded"].includes(harnessRunStatus)
        ) {
          throw new Error(
            "A geração não atingiu um estado terminal após várias tentativas de reconexão.",
          )
        }
      } else {
        let parsedStream: Awaited<ReturnType<typeof parseChatStream>> | null =
          null
        const response = await apiFetch(
          selectedProviderId === AUTO_PROVIDER_ID
            ? "/v1/chat/completions"
            : `${selectedProvider.base}/api/chat`,
          {
            body: JSON.stringify(
              selectedProviderId === AUTO_PROVIDER_ID
                ? {
                    max_tokens: requestPayload.max_tokens,
                    messages: messagesToSend,
                    model: selectedModelId,
                  }
                : { ...requestPayload, messages: messagesToSend },
            ),
            headers: {
              "Content-Type": "application/json",
              ...projectHeaders,
              ...backstageHeaders,
            },
            method: "POST",
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          const errorMessage = await parseApiErrorResponse(response)
          const requestError = new Error(errorMessage) as ChatRequestError
          requestError.status = response.status
          requestError.suppressToast =
            selectedProviderId === "duckai" && response.status === 503
          throw requestError
        }

        const {
          resolvedLabel: resolvedAssistantLabel,
          fallbackMeta: modelFallbackMeta,
        } = resolveModelFallbackFromHeaders(
          response,
          assistantModelLabel,
          models,
          selectedProvider.label,
        )

        effectiveModelLabel = resolvedAssistantLabel ?? assistantModelLabel

        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantMessageId) {
              return message
            }
            const next: ChatMessage = {
              ...message,
              modelLabel: resolvedAssistantLabel,
            }
            if (modelFallbackMeta) {
              next.modelFallbackMeta = modelFallbackMeta
            } else {
              delete next.modelFallbackMeta
            }
            return next
          }),
        )

        const toolMap = new Map<string, ParsedToolCall>()
        parsedStream = await parseChatStream(response, {
          onTextDelta(delta) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            )
          },
          onToolResult(toolCallId, result) {
            const existing = toolMap.get(toolCallId)
            if (!existing) {
              return
            }

            const updated: ParsedToolCall = {
              ...existing,
              result,
              status: "completed",
            }
            toolMap.set(toolCallId, updated)
            updateAssistantToolCall(assistantMessageId, updated)
          },
          onToolStart(toolCall) {
            toolMap.set(toolCall.toolCallId, toolCall)
            updateAssistantToolCall(assistantMessageId, toolCall)
          },
        })

        if (!parsedStream) {
          throw new Error("Nenhum stream recebido.")
        }
        fullText = parsedStream.text

        if (parsedStream.finishReason === "length") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, truncated: true }
                : message,
            ),
          )
        }

        const errorContent = resolveStreamErrorContent(
          parsedStream,
          fullText,
          selectedProviderId,
        )
        if (errorContent) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: errorContent, isError: true }
                : message,
            ),
          )
          return
        }
      }

      if (fullText) {
        // Detecção de canvas (client-side, pós-stream — spec v2)
        let assistantParts: HydratedConversationMessagePart[] = [
          { text: fullText, type: "text" },
        ]
        let displayContent = fullText
        let convIdEarly = harnessConversationId ?? activeConversationId
        let createdConversation = harnessPersisted && !activeConversationId

        const suggestion = temporaryChat
          ? null
          : detectCanvas(fullText, { explicitIntent: canvasIntent })
        if (suggestion) {
          try {
            if (!convIdEarly) {
              convIdEarly = await ensureConversationId(
                text || currentAttachments[0]?.fileName || suggestion.title,
              )
              createdConversation = true
            }
            const activeInConversation =
              activeCanvas && activeCanvas.conversationId === convIdEarly
            const canvas = activeInConversation
              ? await updateCanvas(activeCanvas.id, {
                  content: suggestion.content,
                  kind: suggestion.kind,
                  language: suggestion.language,
                })
              : await createCanvas(convIdEarly, {
                  content: suggestion.content,
                  kind: suggestion.kind,
                  language: suggestion.language,
                  title: suggestion.title,
                })
            setActiveCanvas(canvas)
            setCanvasPanelOpen(true)
            displayContent = buildDisplayText(fullText, suggestion)
            const canvasPart: CanvasReferencePart = {
              canvasId: canvas.id,
              kind: canvas.kind,
              title: canvas.title,
              type: "canvas",
            }
            assistantParts = displayContent
              ? [{ text: displayContent, type: "text" }, canvasPart]
              : [canvasPart]
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: displayContent,
                      parts: assistantParts,
                    }
                  : message,
              ),
            )
          } catch (error) {
            // Canvas é best-effort (a resposta permanece íntegra), mas o erro
            // precisa ser visível para diagnóstico em produção.
            console.error("[canvas] falha ao criar/atualizar canvas", error)
            toast.error(
              `Falha ao abrir o Canvas: ${error instanceof Error ? error.message : "erro desconhecido"}`,
            )
          }
        }

        const projectedAssistantId =
          harnessRunStatus === "completed" && harnessAssistantMessageId
            ? harnessAssistantMessageId
            : assistantMessageId
        setConversation((current) => [
          ...current,
          {
            id: projectedAssistantId,
            parts: assistantParts,
            role: "assistant",
          },
        ])

        if (harnessPersisted) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: displayContent,
                    id: projectedAssistantId,
                    modelLabel: effectiveModelLabel,
                    parts: assistantParts,
                  }
                : message,
            ),
          )
          if (
            harnessRunStatus === "completed" &&
            harnessConversationId &&
            harnessAssistantMessageId
          ) {
            await apiJsonRequest(
              `/harness/conversations/${harnessConversationId}/messages/${harnessAssistantMessageId}/projection`,
              "PATCH",
              {
                content: displayContent,
                modelLabel: effectiveModelLabel,
                parts: assistantParts,
              },
            ).catch((error) => {
              console.error("[harness] falha ao atualizar projeção", error)
            })
          }
          setSidebarRefreshKey((key) => key + 1)
          if (!activeConversationId && harnessConversationId) {
            const titleConversationId = harnessConversationId
            void (async () => {
              try {
                const titleMessages = [
                  {
                    role: "user",
                    parts: [
                      {
                        text: buildTitleGenerationPrompt(text, fullText),
                        type: "text",
                      },
                    ],
                  },
                ]
                const titleResponse = await apiFetch(
                  selectedProviderId === AUTO_PROVIDER_ID
                    ? "/v1/chat/completions"
                    : `${selectedProvider.base}/api/chat`,
                  {
                    body: JSON.stringify(
                      selectedProviderId === AUTO_PROVIDER_ID
                        ? { messages: titleMessages, model: selectedModelId }
                        : {
                            messages: titleMessages,
                            modelId: selectedProvider.hasModels
                              ? selectedModelId
                              : undefined,
                          },
                    ),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                  },
                )
                if (!titleResponse.ok) return
                const titleResult = await parseChatStream(titleResponse, {})
                const cleanTitle = titleResult.text
                  .trim()
                  .replaceAll(/^["']|["']$/g, "")
                  .slice(0, 100)
                if (!cleanTitle) return
                await apiJsonRequest(
                  `/conversations/${titleConversationId}`,
                  "PATCH",
                  { title: cleanTitle },
                )
                setSidebarRefreshKey((key) => key + 1)
              } catch {
                // Title generation remains best effort.
              }
            })()
          }
        }

        // Persist conversation (skip in temporary chat mode)
        if (!temporaryChat && !harnessPersisted)
          try {
            let convId = convIdEarly
            let isNewConversation = createdConversation
            if (!convId) {
              convId = await ensureConversationId(
                text || currentAttachments[0]?.fileName || "Nova conversa",
              )
              isNewConversation = true
            }
            const persisted = await persistMessagesForConversation(convId, [
              { parts: messageParts, role: "user" },
              {
                content: displayContent,
                id: assistantMessageId,
                modelLabel: effectiveModelLabel,
                parts: assistantParts,
                role: "assistant",
              },
            ])
            const [persistedUserMessage, persistedAssistantMessage] =
              persisted.messages
            if (persistedUserMessage && persistedAssistantMessage) {
              setConversation((current) =>
                current.map((message) => {
                  if (message.id === userMessageId) {
                    return {
                      id: persistedUserMessage.id,
                      parts: persistedUserMessage.parts,
                      role: persistedUserMessage.role,
                    }
                  }

                  if (message.id === assistantMessageId) {
                    return {
                      id: persistedAssistantMessage.id,
                      parts: persistedAssistantMessage.parts,
                      role: persistedAssistantMessage.role,
                    }
                  }

                  return message
                }),
              )
              setMessages((current) =>
                current.map((message) => {
                  if (message.id === userMessageId) {
                    return hydrateChatMessage({ message: persistedUserMessage })
                  }

                  if (message.id === assistantMessageId) {
                    return {
                      ...message,
                      backstage: persistedAssistantMessage.backstage,
                      content: persistedAssistantMessage.content,
                      id: persistedAssistantMessage.id,
                    }
                  }

                  return message
                }),
              )
            }
            setSidebarRefreshKey((k) => k + 1)

            // Generate AI title for new conversations (fire-and-forget)
            if (
              isNewConversation &&
              selectedProvider &&
              browserProviderAdapter?.titleGeneration !== "unsupported"
            ) {
              const titleConvId = convId
              void (async () => {
                try {
                  const titleMessages = [
                    {
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: buildTitleGenerationPrompt(text, fullText),
                        },
                      ],
                    },
                  ]
                  const titleResponse = await apiFetch(
                    selectedProviderId === AUTO_PROVIDER_ID
                      ? "/v1/chat/completions"
                      : `${selectedProvider.base}/api/chat`,
                    {
                      body: JSON.stringify(
                        selectedProviderId === AUTO_PROVIDER_ID
                          ? { messages: titleMessages, model: selectedModelId }
                          : {
                              messages: titleMessages,
                              modelId: selectedProvider.hasModels
                                ? selectedModelId
                                : undefined,
                            },
                      ),
                      headers: { "Content-Type": "application/json" },
                      method: "POST",
                    },
                  )
                  if (titleResponse.ok) {
                    const titleResult = await parseChatStream(titleResponse, {})
                    const cleanTitle = titleResult.text
                      .trim()
                      .replaceAll(/^["']|["']$/g, "")
                      .slice(0, 100)
                    if (cleanTitle) {
                      await apiJsonRequest(
                        `/conversations/${titleConvId}`,
                        "PATCH",
                        { title: cleanTitle },
                      )
                      setSidebarRefreshKey((k) => k + 1)
                    }
                  }
                } catch {
                  // Title generation failure is non-blocking
                }
              })()
            }
          } catch {
            // Persistence failure is non-blocking
          }
      }
    } catch (error) {
      // Don't show error for user-initiated abort
      if (error instanceof DOMException && error.name === "AbortError") {
        // Keep whatever text was streamed so far
        return
      }

      if (error instanceof HarnessActiveRunError) {
        setConversation(baseConversation)
        setMessages((current) =>
          current.filter(
            (message) =>
              message.id !== userMessageId && message.id !== assistantMessageId,
          ),
        )
        if (!options?.overrideText) setInput(text)
        if (!options?.overrideAttachments) setAttachments(attachments)
        toast.error(error.message, {
          action: {
            label: "Cancelar execução",
            onClick: () => {
              void apiJsonRequest(
                `/harness/agent-runs/${error.runId}/cancel`,
                "POST",
              )
                .then(() => toast.success("Execução anterior cancelada."))
                .catch((cancelError) => {
                  toast.error(
                    cancelError instanceof Error
                      ? cancelError.message
                      : "Não foi possível cancelar a execução.",
                  )
                })
            },
          },
        })
        return
      }

      const requestError = error as ChatRequestError
      if (browserProviderAdapter) {
        setBrowserProviderAuthState("signed-out")
      }
      let errorMsg: string
      if (requestError.suppressToast) {
        errorMsg = DUCKAI_TEMPORARY_INLINE_MESSAGE
      } else if (error instanceof Error) {
        errorMsg = `Erro: ${error.message}`
      } else {
        errorMsg = "Erro ao enviar mensagem."
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: errorMsg, isError: true }
            : message,
        ),
      )
      if (!requestError.suppressToast) {
        toast.error(
          error instanceof Error ? error.message : "Falha ao enviar mensagem.",
        )
      }
    } finally {
      if (activeGenerationIdRef.current === generationId) {
        activeGenerationIdRef.current = null
        activeHarnessRunIdRef.current = null
        setPending(false)
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  // Regenerate last assistant response
  async function handleRegenerate() {
    if (pending || !selectedProvider || messages.length < 2) return

    const lastUserMsgIndex = messages.map((m) => m.role).lastIndexOf("user")
    if (lastUserMsgIndex === -1) return

    const lastUserMsg = messages[lastUserMsgIndex]
    const regenerateText = getUserMessageText(lastUserMsg)
    const regenerateAttachments = (lastUserMsg.parts ?? []).filter(
      isHydratedAttachmentPart,
    )
    const conversationUserIndex = conversation.findIndex(
      (entry) => entry.id === lastUserMsg.id,
    )
    const baseConversation =
      conversationUserIndex >= 0
        ? conversation.slice(0, conversationUserIndex)
        : conversation.slice(0, lastUserMsgIndex)
    const lastAssistantMessage = messages.at(-1)

    if (activeConversationId && lastAssistantMessage?.role === "assistant") {
      try {
        await trimConversation(activeConversationId, {
          fromMessageId: lastAssistantMessage.id,
        })
      } catch {
        toast.error("Falha ao preparar a conversa para regeneracao.")
        return
      }
    }

    setMessages((current) => current.slice(0, lastUserMsgIndex))
    setConversation(baseConversation)
    void sendMessage({
      baseConversation,
      overrideAttachments: regenerateAttachments,
      overrideText: regenerateText,
    })
  }

  // Share conversation
  async function handleShareConversation() {
    if (!activeConversationId) return
    try {
      const data = await apiJsonRequest<{ shareToken: string }>(
        `/conversations/${activeConversationId}/share`,
        "POST",
      )
      const shareUrl = `${globalThis.location.origin}/share/${data.shareToken}`
      await navigator.clipboard.writeText(shareUrl)
      toast.success("Link de compartilhamento copiado!")
    } catch {
      toast.error("Falha ao gerar link de compartilhamento.")
    }
  }

  // Converte manualmente uma resposta existente em Canvas.
  // Útil para mensagens anteriores à detecção automática ou respostas de modelos
  // que produziram um fence menor que os limiares normais.
  async function handleOpenMessageInCanvas(message: ChatMessage) {
    if (message.role !== "assistant" || !message.content.trim()) return

    try {
      const convId =
        activeConversationId ?? (await ensureConversationId("Canvas"))
      const suggestion = detectCanvas(message.content, { explicitIntent: true })
      const fallbackTitle =
        message.content
          .split("\n")
          .map((line) => line.replace(/^#+\s*/, "").trim())
          .find(Boolean)
          ?.slice(0, 60) || "Canvas"
      const candidate = suggestion ?? {
        content: message.content,
        kind: "markdown" as const,
        language: null,
        title: fallbackTitle,
      }
      const canvas = await createCanvas(convId, {
        content: candidate.content,
        kind: candidate.kind,
        language: candidate.language,
        title: candidate.title,
      })
      const canvasPart: CanvasReferencePart = {
        canvasId: canvas.id,
        kind: canvas.kind,
        title: canvas.title,
        type: "canvas",
      }
      const displayContent = suggestion
        ? buildDisplayText(message.content, suggestion)
        : message.content

      setActiveCanvas(canvas)
      setCanvasPanelOpen(true)
      setMessages((current) =>
        current.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                content: displayContent,
                parts: [
                  ...(entry.parts?.filter((part) => part.type !== "canvas") ??
                    []),
                  canvasPart,
                ],
              }
            : entry,
        ),
      )
      toast.success("Canvas aberto.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao abrir o Canvas.",
      )
    }
  }

  // Continue generation — send "Continue" as a follow-up to get the model to keep going
  async function handleContinueGeneration() {
    if (pending || !selectedProvider) return
    void sendMessage({ overrideText: "Continue" })
  }

  // Edit a user message and re-send
  function handleStartEdit(messageId: string, content: string) {
    setEditingMessageId(messageId)
    setEditingContent(content)
  }

  function handleCancelEdit() {
    setEditingMessageId(null)
    setEditingContent("")
  }

  async function handleSubmitEdit(messageId: string) {
    if (!editingContent.trim() || pending) return

    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) return

    const editText = editingContent.trim()
    const editedMessage = messages[msgIndex]
    const editedAttachments = (editedMessage.parts ?? []).filter(
      isHydratedAttachmentPart,
    )
    const convIndex = conversation.findIndex((item) => item.id === messageId)
    const baseConversation =
      convIndex >= 0
        ? conversation.slice(0, convIndex)
        : conversation.slice(0, msgIndex)

    if (activeConversationId) {
      try {
        await trimConversation(activeConversationId, {
          fromMessageId: messageId,
        })
      } catch {
        toast.error("Falha ao atualizar a conversa antes da edicao.")
        return
      }
    }

    setMessages((current) => current.slice(0, msgIndex))
    setConversation(baseConversation)

    setEditingMessageId(null)
    setEditingContent("")

    void sendMessage({
      baseConversation,
      overrideAttachments: editedAttachments,
      overrideText: editText,
    })
  }

  // Export conversation
  function getExportableContent(m: ChatMessage): string {
    return m.role === "user" && m.parts?.length
      ? createMessageContentFallback(m.parts)
      : m.content
  }

  function handleExportMarkdown() {
    if (messages.length === 0) return

    const mdContent = conversationToMarkdown(
      null,
      messages.map((m) => ({ content: getExportableContent(m), role: m.role })),
    )

    downloadTextFile(
      buildExportFilename(null, "md"),
      "text/markdown",
      mdContent,
    )
    toast.success("Conversa exportada como Markdown.")
  }

  function handleExportJson() {
    if (messages.length === 0) return

    const jsonContent = conversationToJson(
      null,
      messages.map((m) => ({
        content: getExportableContent(m),
        createdAt: m.createdAt ?? null,
        id: m.id,
        modelLabel: m.modelLabel ?? null,
        role: m.role,
      })),
    )

    downloadTextFile(
      buildExportFilename(null, "json"),
      "application/json",
      jsonContent,
    )
    toast.success("Conversa exportada como JSON.")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Toolbar: provider/modelo rolam horizontalmente; as ações ficam fixas à direita */}
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2 md:px-4">
          <div className="flex min-w-0 flex-1 touch-pan-x flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1.5 [scrollbar-width:thin]">
            <Select
              value={selectedProviderId}
              onValueChange={setSelectedProviderId}
            >
              <SelectTrigger
                aria-label="Selecionar provider"
                className="h-8 w-auto max-w-[min(200px,55vw)] shrink-0 text-xs sm:min-w-[140px] sm:max-w-[200px]"
              >
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Roteamento</SelectLabel>
                  <SelectItem value={AUTO_PROVIDER_ID}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">ModelHub</span>
                      <SparklesIcon
                        className="size-3 shrink-0 text-primary"
                        aria-label="Smart Routing"
                      />
                    </span>
                  </SelectItem>
                </SelectGroup>
                <SelectSeparator />
                {openclawProviders.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Ambientes OpenClaw</SelectLabel>
                    {openclawProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        <span className="truncate">{provider.label}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {openclawProviders.length > 0 ? <SelectSeparator /> : null}
                {configuredProvidersWithApiKey.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Configurados</SelectLabel>
                    {configuredProvidersWithApiKey.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{provider.label}</span>
                          <CheckIcon
                            className="size-3 shrink-0 text-emerald-600/65 dark:text-emerald-500/70"
                            aria-label="Configurado"
                          />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {configuredProvidersWithApiKey.length > 0 ? (
                  <SelectSeparator />
                ) : null}
                {providersWithoutApiKey.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Sem chave de API</SelectLabel>
                    {providersWithoutApiKey.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {providersWithoutApiKey.length > 0 ? <SelectSeparator /> : null}
                {providersWithBrowserSession.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Sessao do navegador</SelectLabel>
                    {providersWithBrowserSession.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {providersWithBrowserSession.length > 0 ? (
                  <SelectSeparator />
                ) : null}
                {unconfiguredProvidersWithApiKey.length > 0 ? (
                  <SelectSeparator />
                ) : null}
                {unconfiguredProvidersWithApiKey.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Com chave de API</SelectLabel>
                    {unconfiguredProvidersWithApiKey.map((provider) => {
                      const check = showConfiguredCheck(provider)
                      return (
                        <SelectItem key={provider.id} value={provider.id}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{provider.label}</span>
                            {check ? (
                              <CheckIcon
                                className="size-3 shrink-0 text-emerald-600/65 dark:text-emerald-500/70"
                                aria-label="Configurado"
                              />
                            ) : null}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>

            {loadingModels ? (
              <Skeleton className="h-8 w-[160px] shrink-0" />
            ) : (
              <Select
                value={selectedModelId}
                onValueChange={setSelectedModelId}
                disabled={
                  !selectedProvider?.hasModels ||
                  !selectedProviderReady ||
                  models.length === 0
                }
              >
                <SelectTrigger
                  aria-label="Selecionar modelo"
                  className="h-8 w-auto max-w-[min(240px,60vw)] shrink-0 text-xs sm:min-w-[140px] sm:max-w-[240px]"
                >
                  <SelectValue
                    placeholder={resolveModelSelectPlaceholder({
                      hasModels: !!selectedProvider?.hasModels,
                      providerReady: !!selectedProviderReady,
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span className="flex items-center gap-1.5">
                          {model.name}
                          {model.capabilities.reasoning && (
                            <Badge
                              variant="secondary"
                              className="h-4 px-1 py-0 text-[9px] leading-none"
                            >
                              Raciocínio
                            </Badge>
                          )}
                          {model.capabilities.fast && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[9px] leading-none text-green-600 border-green-500/40"
                            >
                              Rápido
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={
                    browserProviderAdapter &&
                    browserProviderAuthState !== "signed-in"
                      ? "secondary"
                      : selectedProviderReady
                        ? "outline"
                        : "destructive"
                  }
                  className="shrink-0 whitespace-nowrap text-xs"
                >
                  {browserProviderAdapter ? (
                    browserProviderAuthState === "loading" ? (
                      "Conectando..."
                    ) : browserProviderAuthState === "signed-in" ? (
                      "Sessao conectada"
                    ) : (
                      "Login necessario"
                    )
                  ) : selectedProviderReady ? (
                    "Conectado"
                  ) : (
                    <>
                      <span className="sm:hidden">Pendente</span>
                      <span className="hidden sm:inline">
                        Credenciais pendentes
                      </span>
                    </>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {browserProviderAdapter
                  ? "Este provider usa uma sessao autenticada no navegador. O envio abre o login se necessario."
                  : selectedProviderReady
                    ? "Provider configurado e pronto para uso."
                    : "Este provider ainda precisa de credenciais antes de enviar mensagens."}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Ações sempre visíveis (fora do scroll) — resolvem a sobreposição no mobile */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 md:size-8"
                  onClick={handleNewChat}
                  aria-label="Nova conversa"
                >
                  <MessageSquarePlusIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Nova conversa</TooltipContent>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon-sm"
              className="size-9 md:hidden"
              type="button"
              onClick={() => setMobileHistoryOpen(true)}
              aria-label="Histórico de conversas"
            >
              <PanelRightIcon className="size-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 md:size-8"
                  aria-label="Mais ações"
                >
                  <MoreVerticalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {browserProviderAdapter ? (
                  <DropdownMenuItem
                    disabled={browserProviderAuthState === "loading"}
                    onSelect={() => void handleBrowserProviderSignIn()}
                  >
                    {browserProviderAuthState === "loading" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <KeyRoundIcon />
                    )}
                    {browserProviderAuthState === "signed-in"
                      ? "Sessão conectada"
                      : "Entrar no provider"}
                  </DropdownMenuItem>
                ) : null}

                {providerUsesStoredCredentials(selectedProvider) &&
                !selectedProviderReady ? (
                  <DropdownMenuItem
                    onSelect={() => setCredentialDialogOpen(true)}
                  >
                    <Settings2Icon />
                    Configurar credenciais
                  </DropdownMenuItem>
                ) : null}

                {browserProviderAdapter ||
                (providerUsesStoredCredentials(selectedProvider) &&
                  !selectedProviderReady) ? (
                  <DropdownMenuSeparator />
                ) : null}

                <DropdownMenuCheckboxItem
                  checked={temporaryChat}
                  onCheckedChange={(checked) => setTemporaryChat(!!checked)}
                >
                  Chat temporário
                </DropdownMenuCheckboxItem>

                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <UserIcon />
                  Personalizar
                </DropdownMenuItem>

                {activeConversationId ? (
                  <DropdownMenuItem
                    onSelect={() => void handleShareConversation()}
                  >
                    <ShareIcon />
                    Compartilhar conversa
                  </DropdownMenuItem>
                ) : null}

                {messages.length > 0 ? (
                  <>
                    <DropdownMenuItem onSelect={handleExportMarkdown}>
                      <DownloadIcon />
                      Exportar (Markdown)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleExportJson}>
                      <DownloadIcon />
                      Exportar (JSON)
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Banner de chat temporário */}
        {temporaryChat && (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-600 dark:text-amber-400">
            <ShieldOffIcon className="mr-1 inline-block size-3" />
            Chat temporário — as mensagens não serão salvas no histórico
          </div>
        )}

        {/* Alerta de credenciais pendentes */}
        {!selectedProviderReady &&
        selectedProvider &&
        providerUsesStoredCredentials(selectedProvider) ? (
          <div className="shrink-0 px-3 pt-3 md:px-4">
            <Alert>
              <KeyRoundIcon data-icon="inline-start" />
              <AlertTitle>
                {selectedProvider.label} exige credenciais
              </AlertTitle>
              <AlertDescription>
                Salve as chaves necessárias antes de carregar modelos ou enviar
                mensagens.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {/* Área de mensagens (scroll nativo para evitar bugs de thumb em produção) */}
        <div
          ref={scrollViewportRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 md:px-4 md:py-6">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <Empty className="max-w-xl border-border/60 bg-muted/20">
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-full">
                      <SparklesIcon className="size-5 text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>Comece uma nova conversa</EmptyTitle>
                    <EmptyDescription className="max-w-md text-sm">
                      Escolha um provider e um modelo, ou use uma sugestão
                      abaixo para reduzir a barreira de entrada.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="max-w-lg">
                    <div className="flex flex-wrap justify-center gap-2">
                      {EMPTY_STATE_PROMPTS.map((prompt) => (
                        <Button
                          key={prompt}
                          variant="outline"
                          size="sm"
                          onClick={() => setInput(prompt)}
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  </EmptyContent>
                </Empty>
              </div>
            ) : (
              messages.map((message, messageIndex) => (
                <div
                  key={message.id}
                  className={cn(
                    "group/msg flex gap-2.5",
                    message.role === "user" ? "flex-row-reverse" : "flex-row",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {message.role === "user" ? (
                      <UserIcon className="size-3.5" />
                    ) : (
                      <BotIcon className="size-3.5" />
                    )}
                  </div>
                  <div className="flex max-w-[85%] flex-col gap-1 sm:max-w-[75%]">
                    {message.role === "assistant" &&
                    message.modelFallbackMeta ? (
                      <Alert className="border-amber-500/40 bg-amber-500/10 py-2 text-amber-950 dark:text-amber-50">
                        <AlertTitle className="text-xs font-semibold">
                          Modelo diferente do que você selecionou
                        </AlertTitle>
                        <AlertDescription className="text-xs leading-relaxed text-amber-950/90 dark:text-amber-50/90">
                          A API não aceitou{" "}
                          <span className="font-medium text-foreground">
                            {message.modelFallbackMeta.requestedLabel}
                          </span>{" "}
                          nesta requisição (por exemplo{" "}
                          <code className="rounded bg-background/80 px-1 py-0.5 text-[11px]">
                            model_not_found
                          </code>{" "}
                          ou sem acesso). O backend tentou, nesta ordem:{" "}
                          <span className="break-all font-mono text-[11px]">
                            {message.modelFallbackMeta.attemptedIds.join(" → ")}
                          </span>
                          . O texto abaixo foi gerado por{" "}
                          <span className="font-medium text-foreground">
                            {message.modelFallbackMeta.effectiveLabel}
                          </span>
                          , não pelo modelo escolhido no seletor.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <div
                      className={cn(
                        "min-w-0 max-w-full overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm",
                        message.role === "user"
                          ? "rounded-tr-md bg-primary text-primary-foreground"
                          : "rounded-tl-md bg-muted",
                        message.isError &&
                          "border border-destructive/30 bg-destructive/10",
                      )}
                    >
                      {/* Editing mode */}
                      {editingMessageId === message.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            className="min-h-[60px] w-full resize-none rounded-lg border border-border bg-background p-2 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-primary md:text-sm"
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                void handleSubmitEdit(message.id)
                              }
                              if (e.key === "Escape") handleCancelEdit()
                            }}
                          />
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              onClick={() => void handleSubmitEdit(message.id)}
                            >
                              Enviar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={handleCancelEdit}
                            >
                              <XIcon className="size-3" /> Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : message.role === "assistant" ? (
                        message.content ||
                        message.parts?.some(
                          (part) => part.type === "canvas",
                        ) ? (
                          <>
                            {message.content ? (
                              <div className="min-w-0 max-w-full overflow-hidden prose-sm">
                                <MarkdownRenderer content={message.content} />
                                {/* Blinking cursor during streaming */}
                                {pending &&
                                  messageIndex === messages.length - 1 &&
                                  !message.isError && (
                                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/70" />
                                  )}
                              </div>
                            ) : null}
                            {message.parts
                              ?.filter(
                                (part): part is CanvasReferencePart =>
                                  part.type === "canvas",
                              )
                              .map((part) => (
                                <CanvasMessageCard
                                  key={part.canvasId}
                                  onOpen={() =>
                                    void openCanvasById(part.canvasId)
                                  }
                                  part={part}
                                />
                              ))}
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2Icon className="size-3 animate-spin" />
                            <span>Gerando resposta</span>
                            <span className="inline-flex gap-0.5">
                              <span className="animate-bounce delay-0">.</span>
                              <span
                                className="animate-bounce"
                                style={{ animationDelay: "0.1s" }}
                              >
                                .
                              </span>
                              <span
                                className="animate-bounce"
                                style={{ animationDelay: "0.2s" }}
                              >
                                .
                              </span>
                            </span>
                          </div>
                        )
                      ) : message.content || message.parts?.length ? (
                        <div className="flex flex-col gap-2">
                          {message.content ? (
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {message.content}
                            </p>
                          ) : null}
                          {message.parts?.filter(isHydratedAttachmentPart)
                            .length ? (
                            <div className="flex flex-wrap gap-2">
                              {message.parts
                                .filter(isHydratedAttachmentPart)
                                .map((part) =>
                                  part.kind === "image" ? (
                                    <a
                                      key={part.attachmentId}
                                      href={part.contentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex flex-col gap-1"
                                    >
                                      <Image
                                        src={part.contentUrl}
                                        alt={part.fileName}
                                        width={160}
                                        height={120}
                                        unoptimized
                                        className="max-h-48 w-auto rounded-xl border border-primary-foreground/20 object-cover"
                                      />
                                      <span className="max-w-40 truncate text-[10px] text-primary-foreground/80">
                                        {part.fileName}
                                      </span>
                                    </a>
                                  ) : (
                                    <a
                                      key={part.attachmentId}
                                      href={part.contentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex min-w-52 max-w-72 items-center justify-between gap-3 rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-medium">
                                          {part.fileName}
                                        </p>
                                        <p className="text-[10px] text-primary-foreground/75">
                                          {buildAttachmentLabel(part)} ·{" "}
                                          {formatBytes(part.byteSize)}
                                        </p>
                                      </div>
                                      <ExternalLinkIcon className="size-3.5 shrink-0" />
                                    </a>
                                  ),
                                )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2Icon className="size-3 animate-spin" />
                          <span>
                            {message.toolCalls.some(
                              (toolCall) =>
                                toolCall.status === "pending-approval",
                            )
                              ? "Aguardando sua aprovação"
                              : message.toolCalls.length > 0
                                ? "Executando ferramentas"
                                : "Gerando resposta"}
                          </span>
                          {!message.toolCalls.some(
                            (toolCall) =>
                              toolCall.status === "pending-approval",
                          ) ? (
                            <span className="inline-flex gap-0.5">
                            <span className="animate-bounce delay-0">.</span>
                            <span
                              className="animate-bounce"
                              style={{ animationDelay: "0.1s" }}
                            >
                              .
                            </span>
                            <span
                              className="animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            >
                              .
                            </span>
                            </span>
                          ) : null}
                        </div>
                      )}

                      {message.toolCalls.length > 0 ? (
                        <div className="mt-2 flex flex-col gap-2 border-t border-border/30 pt-2">
                          {message.toolCalls.map((toolCall) => (
                            <div
                              key={toolCall.toolCallId}
                              className="rounded-lg bg-background/50 p-2.5"
                            >
                              <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">
                                  {toolCall.toolName}
                                </span>
                                <Badge
                                  variant={
                                    toolCall.status === "completed"
                                      ? "secondary"
                                      : toolCall.status === "pending-approval"
                                        ? "destructive"
                                        : "outline"
                                  }
                                  className="h-5 text-[10px]"
                                >
                                  {toolCall.status === "completed"
                                    ? "OK"
                                    : toolCall.status === "pending-approval"
                                      ? "Aprovar"
                                      : "…"}
                                </Badge>
                              </div>
                              <pre className="overflow-x-auto rounded bg-background p-2 text-[10px] leading-5 text-muted-foreground">
                                {JSON.stringify(
                                  {
                                    args: toolCall.args,
                                    result: toolCall.result ?? null,
                                  },
                                  null,
                                  2,
                                )}
                              </pre>
                              {toolCall.status === "pending-approval" &&
                              toolCall.approvalId ? (
                                <div className="mt-2 flex justify-end gap-2">
                                  <Button
                                    disabled={pending}
                                    onClick={() =>
                                      void handleHarnessApproval(
                                        message.id,
                                        toolCall,
                                        "denied",
                                      )
                                    }
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    Negar
                                  </Button>
                                  <Button
                                    disabled={pending}
                                    onClick={() =>
                                      void handleHarnessApproval(
                                        message.id,
                                        toolCall,
                                        "approved",
                                      )
                                    }
                                    size="sm"
                                    type="button"
                                  >
                                    Aprovar
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {(message.createdAt ||
                      (message.role === "assistant" && message.modelLabel)) && (
                      <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground/60">
                        <span>
                          {message.createdAt &&
                            formatMessageTimestamp(message.createdAt)}
                          {message.createdAt &&
                          message.role === "assistant" &&
                          message.modelLabel
                            ? " - "
                            : ""}
                          {message.role === "assistant" &&
                            message.modelLabel &&
                            message.modelLabel}
                        </span>
                        {message.role === "assistant" && message.backstage && (
                          <span>
                            {formatBackstageInline(
                              message.backstage,
                              message.content,
                            )}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Action buttons below the bubble */}
                    {editingMessageId !== message.id &&
                      (message.content || message.parts?.length) &&
                      !pending && (
                        <div
                          className={cn(
                            // No touch (sem hover) as ações ficam sempre visíveis; no desktop aparecem ao passar o mouse
                            "flex gap-1 opacity-100 transition-opacity md:gap-0.5 md:opacity-0 md:group-hover/msg:opacity-100",
                            message.role === "user"
                              ? "flex-row-reverse"
                              : "flex-row",
                          )}
                        >
                          {/* Copy */}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-8 md:size-6"
                            onClick={() =>
                              handleCopyMessage(
                                message.id,
                                message.role === "user"
                                  ? getUserMessageText(message)
                                  : message.content,
                              )
                            }
                            title="Copiar mensagem"
                          >
                            {copiedMessageId === message.id ? (
                              <CheckIcon className="size-3" />
                            ) : (
                              <CopyIcon className="size-3" />
                            )}
                          </Button>

                          {/* Edit (user only) */}
                          {message.role === "user" && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="size-8 md:size-6"
                              onClick={() =>
                                handleStartEdit(
                                  message.id,
                                  getUserMessageText(message),
                                )
                              }
                              title="Editar mensagem"
                            >
                              <PencilIcon className="size-3" />
                            </Button>
                          )}

                          {/* Reactions (assistant only) */}
                          {message.role === "assistant" && !message.isError && (
                            <>
                              <Button
                                variant={
                                  reactions[message.id] === "thumbs_up"
                                    ? "default"
                                    : "ghost"
                                }
                                size="icon-xs"
                                className="size-8 md:size-6"
                                onClick={() =>
                                  void handleReaction(message.id, "thumbs_up")
                                }
                                title="Boa resposta"
                              >
                                <ThumbsUpIcon className="size-3" />
                              </Button>
                              <Button
                                variant={
                                  reactions[message.id] === "thumbs_down"
                                    ? "default"
                                    : "ghost"
                                }
                                size="icon-xs"
                                className="size-8 md:size-6"
                                onClick={() =>
                                  void handleReaction(message.id, "thumbs_down")
                                }
                                title="Resposta ruim"
                              >
                                <ThumbsDownIcon className="size-3" />
                              </Button>
                            </>
                          )}
                          {message.role === "assistant" &&
                            reactions[message.id] === "thumbs_down" && (
                              <Textarea
                                className="mt-1 h-14 w-full basis-full text-xs"
                                onBlur={() =>
                                  void handleSaveReactionNote(message.id)
                                }
                                onChange={(
                                  e: React.ChangeEvent<HTMLTextAreaElement>,
                                ) =>
                                  setReactionNotes((prev) => ({
                                    ...prev,
                                    [message.id]: e.target.value,
                                  }))
                                }
                                placeholder="O que deu errado nessa resposta? (opcional)"
                                value={reactionNotes[message.id] ?? ""}
                              />
                            )}

                          {/* Bastidores: roteamento, fallback, tempo e tokens da resposta */}
                          {message.role === "assistant" &&
                            !message.isError &&
                            message.backstage && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-8 md:size-6"
                                onClick={() =>
                                  setBackstageOpenMessageId(message.id)
                                }
                                title="Ver bastidores da resposta"
                              >
                                <RouteIcon className="size-3" />
                              </Button>
                            )}

                          {/* Abrir uma resposta existente no Canvas */}
                          {message.role === "assistant" &&
                          !message.isError &&
                          message.content.trim().length >= 40 &&
                          !message.parts?.some(
                            (part) => part.type === "canvas",
                          ) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs md:h-6 md:text-[10px]"
                              onClick={() =>
                                void handleOpenMessageInCanvas(message)
                              }
                              title="Abrir esta resposta no Canvas"
                            >
                              <FrameIcon className="size-3" />
                              Canvas
                            </Button>
                          ) : null}

                          {/* Regenerate (last assistant only) */}
                          {message.role === "assistant" &&
                            messageIndex === messages.length - 1 && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-8 md:size-6"
                                onClick={() => void handleRegenerate()}
                                title="Regenerar resposta"
                              >
                                <RefreshCwIcon className="size-3" />
                              </Button>
                            )}

                          {/* Continue generation (last assistant, truncated) */}
                          {message.role === "assistant" &&
                            messageIndex === messages.length - 1 &&
                            message.truncated &&
                            !message.isError &&
                            message.content && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-8 md:size-6"
                                onClick={() => void handleContinueGeneration()}
                                title="Continuar gerando"
                              >
                                <PlayIcon className="size-3" />
                              </Button>
                            )}

                          {/* Retry on error */}
                          {message.isError && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs md:h-6 md:text-[10px]"
                              onClick={() => void handleRegenerate()}
                            >
                              <RefreshCwIcon className="size-3" /> Tentar
                              novamente
                            </Button>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Input fixo no bottom — pb respeita a barra de gestos (safe-area) em celulares */}
        <div className="shrink-0 border-t border-border/60 bg-background px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:px-4 md:pt-3 md:pb-3">
          <div className="mx-auto max-w-3xl">
            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div key={att.id} className="group relative">
                    {att.kind === "image" && att.previewUrl ? (
                      <Image
                        src={att.previewUrl}
                        alt={att.fileName}
                        width={64}
                        height={64}
                        unoptimized
                        className="size-16 rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-muted text-[10px] text-muted-foreground">
                        DOC
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      // Sempre visível no touch; só esconde/revela no hover em telas com mouse
                      className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity md:size-5 md:opacity-0 md:group-hover:opacity-100"
                      title="Remover"
                    >
                      <XIcon className="size-3.5 md:size-3" />
                    </button>
                    <p className="mt-0.5 max-w-24 truncate text-center text-[9px] text-muted-foreground">
                      {att.fileName}
                    </p>
                    <p className="text-center text-[9px] text-muted-foreground">
                      {att.status === "uploading"
                        ? "Processando..."
                        : buildAttachmentLabel(att)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={[
                ...(allowImageAttachments ? ACCEPTED_IMAGE_TYPES : []),
                ...(allowDocumentAttachments ? ACCEPTED_DOCUMENT_TYPES : []),
              ].join(",")}
              multiple
              className="hidden"
              onChange={(e) => void handleFileSelect(e)}
            />

            <InputGroup className="min-h-[2.75rem] items-stretch">
              <InputGroupTextarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void sendMessage()
                  }
                }}
                placeholder="Pergunte algo..."
                // text-base (16px) no mobile evita o zoom automático do Safari iOS ao focar
                className="min-h-[2.25rem] text-base md:text-sm"
              />
              <InputGroupAddon
                align="block-end"
                className="justify-between gap-2 border-t px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          aria-label="Anexar arquivo"
                          variant="ghost"
                          size="icon-xs"
                          className="size-8 md:size-6"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={
                            pending ||
                            (!allowImageAttachments &&
                              !allowDocumentAttachments)
                          }
                        >
                          <PaperclipIcon className="size-3" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Limites: {formatBytes(MAX_ATTACHMENT_FILE_BYTES)} por
                      imagem, {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} em
                      imagens, {formatBytes(MAX_DOCUMENT_ATTACHMENT_FILE_BYTES)}{" "}
                      por documento,{" "}
                      {formatBytes(MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES)} em
                      documentos e{" "}
                      {formatBytes(MAX_SERIALIZED_CHAT_REQUEST_BYTES)} por
                      request.
                    </TooltipContent>
                  </Tooltip>
                  {projectOptions.length > 0 ? (
                    <Select
                      onValueChange={(value) =>
                        setActiveProjectId(value === "__none__" ? null : value)
                      }
                      value={activeProjectId ?? "__none__"}
                    >
                      <SelectTrigger
                        aria-label="Selecionar projeto da conversa"
                        className="h-7 w-auto max-w-[150px] shrink-0 border-dashed text-[11px]"
                        title="Projeto do contexto da conversa"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sem projeto</SelectItem>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            <span className="max-w-[180px] truncate">
                              {project.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <InputGroupText className="max-w-[55vw] truncate text-xs sm:max-w-none">
                    {selectedProvider?.label ?? "Provider"}
                    {selectedModelId
                      ? ` · ${models.find((model) => model.id === selectedModelId)?.name ?? selectedModelId}`
                      : ""}
                  </InputGroupText>
                </div>
                {pending ? (
                  <Button
                    aria-label="Parar geração"
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={handleStopGeneration}
                  >
                    <SquareIcon className="size-3" />
                    <span className="hidden sm:inline">Parar</span>
                  </Button>
                ) : (
                  <InputGroupButton
                    aria-label="Enviar mensagem"
                    size="sm"
                    disabled={
                      (!input.trim() && attachments.length === 0) ||
                      composerHasUploadingAttachments
                    }
                    onClick={() => void sendMessage()}
                  >
                    <SendHorizontalIcon className="size-3.5" />
                    <span className="hidden sm:inline">Enviar</span>
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>

        <Dialog
          open={credentialDialogOpen}
          onOpenChange={setCredentialDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Credenciais do provider</DialogTitle>
              <DialogDescription>
                {selectedProvider
                  ? `Salve as chaves necessárias para usar ${selectedProvider.label}.`
                  : "Selecione um provider antes de editar credenciais."}
              </DialogDescription>
            </DialogHeader>
            {selectedProvider ? (
              <div className="flex flex-col gap-5">
                {selectedProvider.signupUrl && (
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
                        {selectedProvider.signupLabel ??
                          "Clique aqui para obter"}
                      </a>
                    </span>
                  </div>
                )}
                <FieldGroup>
                  {(selectedProvider.requiredKeys ?? []).map((field) => (
                    <Field key={field.envName}>
                      <FieldLabel htmlFor={field.envName}>
                        {field.label}
                      </FieldLabel>
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
                      <FieldDescription>
                        Informe a chave recebida no painel deste provider.
                      </FieldDescription>
                    </Field>
                  ))}
                </FieldGroup>
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={savingCredentials}
                    onClick={() => void saveCredentials()}
                  >
                    {savingCredentials && (
                      <Loader2Icon className="size-3 animate-spin" />
                    )}
                    {savingCredentials
                      ? "Testando conexão…"
                      : "Salvar credenciais"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={savingCredentials}
                    onClick={() => void clearCredentials()}
                  >
                    Limpar
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {(() => {
          const backstageMessage = messages.find(
            (m) => m.id === backstageOpenMessageId,
          )
          if (!backstageMessage?.backstage) return null
          return (
            <MessageBackstageDialog
              backstage={backstageMessage.backstage}
              open={backstageOpenMessageId !== null}
              onOpenChange={(next) =>
                setBackstageOpenMessageId(next ? backstageOpenMessageId : null)
              }
              responseText={backstageMessage.content}
            />
          )
        })()}
      </div>

      {/* Painel do canvas — split-pane redimensionável no desktop, sheet no mobile */}
      {isMobile ? (
        <Sheet onOpenChange={setCanvasPanelOpen} open={canvasPanelOpen}>
          <SheetContent
            className="h-[92vh] w-full p-0 sm:max-w-full"
            side="bottom"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Canvas</SheetTitle>
            </SheetHeader>
            <div className="h-full">
              <CanvasPanel
                canvas={activeCanvas}
                includeInContext={includeCanvasContext}
                loading={false}
                onClose={() => setCanvasPanelOpen(false)}
                onCanvasUpdated={setActiveCanvas}
                onIncludeInContextChange={setIncludeCanvasContext}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : canvasPanelOpen ? (
        <div
          className="hidden h-full min-h-0 shrink-0 border-l border-border/60 bg-background md:flex"
          style={{ width: canvasWidth }}
        >
          <div
            className="group relative -left-1 z-10 w-2 shrink-0 cursor-col-resize focus-visible:outline-none"
            aria-valuemax={760}
            aria-valuemin={340}
            aria-valuenow={canvasWidth}
            onPointerDown={beginCanvasResize}
            onKeyDown={handleCanvasResizeKeyDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar painel do canvas"
            tabIndex={0}
          >
            <div className="h-full w-full transition-colors group-hover:bg-primary/25 group-focus-visible:bg-primary/40" />
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <CanvasPanel
              canvas={activeCanvas}
              includeInContext={includeCanvasContext}
              loading={false}
              onClose={() => setCanvasPanelOpen(false)}
              onCanvasUpdated={setActiveCanvas}
              onIncludeInContextChange={setIncludeCanvasContext}
            />
          </div>
        </div>
      ) : null}

      <ChatHistorySidebar
        activeConversationId={activeConversationId}
        activeProjectId={activeProjectId}
        mobileSheetOpen={mobileHistoryOpen}
        onMobileSheetOpenChange={setMobileHistoryOpen}
        onSelectConversation={(id) => void handleSelectConversation(id)}
        onNewChat={handleNewChat}
        refreshKey={sidebarRefreshKey}
      />
    </div>
  )
}

const CANVAS_KIND_ICON_LABEL: Record<string, string> = {
  code: "Código",
  html: "HTML",
  markdown: "Documento",
  mermaid: "Diagrama",
  react: "React",
}

function CanvasMessageCard({
  onOpen,
  part,
}: {
  onOpen: () => void
  part: CanvasReferencePart
}) {
  return (
    <button
      className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted"
      onClick={onOpen}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FrameIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{part.title}</span>
        <span className="block text-[10px] text-muted-foreground">
          Canvas · {CANVAS_KIND_ICON_LABEL[part.kind] ?? part.kind}
        </span>
      </span>
      <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}
