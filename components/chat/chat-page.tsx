"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  type CloudDeploymentSummary,
  type CanvasDetail,
  type ProviderModel,
  type ProjectSummary,
  type UiProvider,
  MODELHUB_PROJECT_HEADER,
} from "@/lib/contracts";
import {
  type AttachmentExtractionStatus,
  type AttachmentKind,
  type CanvasReferencePart,
  type ConversationAttachmentDescriptor,
  type HydratedAttachmentPart,
  type HydratedConversationMessagePart,
  createMessageContentFallback,
} from "@/lib/chat-parts";
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
} from "lucide-react";
import { toast } from "sonner";

import { useAppState } from "@/components/app-state-provider";
import { CanvasPanel } from "@/components/canvas/canvas-panel";
import { ChatHistorySidebar } from "@/components/chat/chat-history-sidebar";
import { SettingsDialog } from "@/components/chat/settings-dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  buildExportFilename,
  conversationToJson,
  conversationToMarkdown,
  downloadTextFile,
} from "@/lib/conversation-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  InputGroupText,
} from "@/components/ui/input-group";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { apiFetch, apiJson, apiJsonRequest } from "@/lib/api";
import { createCanvas, getCanvas, listCanvases, listProjects, updateCanvas } from "@/lib/canvas-client";
import {
  buildDisplayText,
  CANVAS_ASSISTANT_GUIDANCE,
  detectCanvas,
  shouldRequestCanvasGuidance,
} from "@/lib/canvas-detector";
import { saveProviderCredentials } from "@/lib/save-provider-credentials";
import {
  getBrowserChatProviderAdapter,
  type BrowserProviderAuthState,
} from "@/lib/browser-chat-providers";
import { useProviderModels } from "@/lib/use-provider-models";
import {
  estimateSerializedPayloadBytes,
  formatBytes,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_DOCUMENT_ATTACHMENT_FILE_BYTES,
  MAX_SERIALIZED_CHAT_REQUEST_BYTES,
  MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  validateFileSelection,
} from "@/lib/chat-attachments";
import { parseChatStream, type ParsedToolCall } from "@/lib/chat-stream";
import {
  providerAuthMode,
  providerCredentialIds,
  providerHasRequiredCredentials,
  providerUsesBrowserSession,
  providerUsesStoredCredentials,
  sortProvidersByConfiguredCredentials,
} from "@/lib/provider-credentials";
import { resolveMaxOutputTokens } from "@/lib/model-output-limits";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  buildAttachmentLabel,
  buildTitleGenerationPrompt,
  buildUserMessageParts,
  DUCKAI_TEMPORARY_INLINE_MESSAGE,
  EMPTY_STATE_PROMPTS,
  formatMessageTimestamp,
  getUserMessageText,
  hydrateChatMessage,
  isHydratedAttachmentPart,
  parseApiErrorResponse,
  persistMessagesForConversation,
  releaseAttachmentPreview,
  resolveAssistantModelLabel,
  resolveModelFallbackFromHeaders,
  resolveModelSelectPlaceholder,
  resolveStickToBottom,
  resolveStreamErrorContent,
  trimConversation,
  validateAttachmentCompatibility,
  type ChatMessage,
  type ChatRequestError,
  type ComposerAttachment,
  type ConversationMessage,
  type PersistedConversationMessage,
} from "@/lib/chat-utils";

const AUTO_PROVIDER_ID = "modelhub-auto";
const AUTO_MODEL: ProviderModel = {
  capabilities: { documents: true, images: true, reasoning: true },
  id: "auto",
  name: "Auto · Smart Routing",
};

export function ChatPage() {
  const { credentials, providers, refreshCredentials } = useAppState();
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [savingCredentials, setSavingCredentials] = useState(false);

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  // Conversation persistence state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // Temporary chat mode — messages are never persisted
  const [temporaryChat, setTemporaryChat] = useState(false);

  // Settings/personalization dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [browserProviderAuthState, setBrowserProviderAuthState] =
    useState<BrowserProviderAuthState>("unknown");

  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const isMobile = useIsMobile();

  // Canvas workspace (spec v2 — fase 2)
  const [activeCanvas, setActiveCanvas] = useState<CanvasDetail | null>(null);
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [includeCanvasContext, setIncludeCanvasContext] = useState(true);
  const [canvasWidth, setCanvasWidth] = useState(() => {
    if (typeof window === "undefined") return 420;
    const stored = Number(window.localStorage.getItem("canvas-panel-width"));
    return Number.isFinite(stored) && stored >= 340 && stored <= 760 ? stored : 420;
  });
  const canvasResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Projeto ativo (contexto de projeto na conversa)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectOptions, setProjectOptions] = useState<ProjectSummary[]>([]);

  function beginCanvasResize(event: React.PointerEvent) {
    event.preventDefault();
    canvasResizeRef.current = { startX: event.clientX, startWidth: canvasWidth };
    const onMove = (moveEvent: PointerEvent) => {
      const state = canvasResizeRef.current;
      if (!state) return;
      const next = Math.min(760, Math.max(340, state.startWidth - (moveEvent.clientX - state.startX)));
      setCanvasWidth(next);
    };
    const onUp = () => {
      canvasResizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setCanvasWidth((current) => {
        window.localStorage.setItem("canvas-panel-width", String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function loadProjectOptions() {
    listProjects()
      .then(setProjectOptions)
      .catch(() => {
        // silencioso — seletor mostra apenas "Sem projeto"
      });
  }

  async function openCanvasById(canvasId: string) {
    try {
      setActiveCanvas(await getCanvas(canvasId));
      setCanvasPanelOpen(true);
    } catch {
      toast.error("Falha ao abrir o canvas.");
    }
  }

  // Stop generation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Smart auto-scroll: só acompanha o fim enquanto o usuário não rolar para cima
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  // Copy message feedback
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Message reactions
  const [reactions, setReactions] = useState<Record<string, string | null>>({});

  // Edit message
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  // File attachments
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic OpenClaw destinations: every healthy OpenClaw deployment with a
  // managed config becomes a virtual provider whose base points at the chat-proxy endpoint.
  const [openclawDeployments, setOpenclawDeployments] = useState<CloudDeploymentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ deployments: CloudDeploymentSummary[] }>("/user/cloud/deployments")
      .then((payload) => {
        if (cancelled) return;
        setOpenclawDeployments(payload.deployments.filter((d) => d.status === "healthy" && d.openclaw));
      })
      .catch(() => {
        if (!cancelled) setOpenclawDeployments([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const searchParams = useSearchParams();
  useEffect(() => {
    const openclawId = searchParams.get("openclaw");
    if (openclawId) {
      const targetProviderId = `openclaw:${openclawId}`;
      const exists = openclawDeployments.some((d) => d.id === openclawId);
      if (exists) {
        setSelectedProviderId(targetProviderId);
        const url = new URL(window.location.href);
        url.searchParams.delete("openclaw");
        window.history.replaceState({}, "", url.toString());
      }
    }

    // ?project=<id>&new=1 — nova conversa vinculada ao projeto (spec v2)
    const projectId = searchParams.get("project");
    if (projectId) {
      setActiveProjectId(projectId);
      if (searchParams.get("new") === "1") {
        attachmentsRef.current.forEach(releaseAttachmentPreview);
        setActiveConversationId(null);
        setMessages([]);
        setConversation([]);
        setInput("");
        setAttachments([]);
        setActiveCanvas(null);
        setCanvasPanelOpen(false);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("project");
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, openclawDeployments]);

  // Carrega opções de projeto para o seletor do composer (uma vez)
  useEffect(() => {
    loadProjectOptions();
  }, []);

  const autoProvider = useMemo<UiProvider>(() => ({
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
  }), []);

  const openclawProviders = useMemo<UiProvider[]>(
    () => {
      const providerLabels = new Map(providers.map((provider) => [provider.id, provider.label]));

      return openclawDeployments.flatMap((deployment) => {
        const openclaw = deployment.openclaw;
        if (!openclaw) return [];

        const providerLabel = providerLabels.get(openclaw.provider) ?? openclaw.provider;

        return [{
          base: `/user/cloud/deployments/${deployment.id}`,
          hasModels: true,
          id: `openclaw:${deployment.id}`,
          label: `OpenClaw · ${deployment.name}`,
          localModels: [{
            capabilities: { documents: true, images: false },
            id: openclaw.model,
            name: `${providerLabel} · ${openclaw.model}`,
          }],
          runtime: {
            authMode: "none",
            externalApi: false,
            kind: "server",
            openAiCompatible: true,
            transport: "modelhub-proxy",
          },
        }];
      });
    },
    [openclawDeployments, providers],
  );

  const selectedProvider = useMemo(
    () =>
      [autoProvider, ...providers, ...openclawProviders].find((provider) => provider.id === selectedProviderId) ??
      null,
    [autoProvider, providers, openclawProviders, selectedProviderId],
  );
  const browserProviderAdapter = useMemo(
    () => getBrowserChatProviderAdapter(selectedProviderId),
    [selectedProviderId],
  );
  const providersWithoutApiKey = useMemo(
    () => providers.filter((provider) => providerAuthMode(provider) === "none"),
    [providers],
  );
  const providersWithBrowserSession = useMemo(
    () => providers.filter(providerUsesBrowserSession),
    [providers],
  );
  const providersWithApiKey = useMemo(
    () => sortProvidersByConfiguredCredentials(
      providers.filter(providerUsesStoredCredentials),
      credentials,
    ),
    [credentials, providers],
  );
  const configuredProvidersWithApiKey = useMemo(
    () => providersWithApiKey.filter((provider) => providerHasRequiredCredentials(provider, credentials)),
    [credentials, providersWithApiKey],
  );
  const unconfiguredProvidersWithApiKey = useMemo(
    () => providersWithApiKey.filter((provider) => !providerHasRequiredCredentials(provider, credentials)),
    [credentials, providersWithApiKey],
  );
  const selectedProviderReady = providerHasRequiredCredentials(selectedProvider, credentials);
  const providerModels = useProviderModels({
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  });
  const { models, selectedModel, selectedModelId, setSelectedModelId } = providerModels;
  const loadingModels = providerModels.loading;

  const showConfiguredCheck = useCallback(
    (provider: UiProvider) => {
      if (providerUsesStoredCredentials(provider)) {
        return providerHasRequiredCredentials(provider, credentials);
      }
      return false;
    },
    [credentials],
  );

  const refreshBrowserProviderAuthState = useCallback(async () => {
    if (!browserProviderAdapter) {
      setBrowserProviderAuthState("unknown");
      return;
    }

    setBrowserProviderAuthState("loading");
    try {
      setBrowserProviderAuthState(await browserProviderAdapter.auth.getState());
    } catch {
      setBrowserProviderAuthState("signed-out");
    }
  }, [browserProviderAdapter]);

  async function handleBrowserProviderSignIn() {
    if (!browserProviderAdapter || !selectedProvider) {
      return;
    }

    setBrowserProviderAuthState("loading");
    try {
      await browserProviderAdapter.auth.signIn();
      setBrowserProviderAuthState("signed-in");
      toast.success(`${selectedProvider.label} conectado.`);
    } catch (error) {
      setBrowserProviderAuthState("signed-out");
      toast.error(error instanceof Error ? error.message : `Nao foi possivel entrar em ${selectedProvider.label}.`);
    }
  }


  const allowImageAttachments = selectedModel?.capabilities.images ?? false;
  const allowDocumentAttachments = selectedModel?.capabilities.documents ?? true;
  const composerHasUploadingAttachments = attachments.some((attachment) => attachment.status === "uploading");

  useEffect(() => {
    if (providers.length === 0 || selectedProviderId) {
      return;
    }

    const preferred =
      (globalThis.window?.localStorage.getItem("selected-provider") ?? null) ??
      AUTO_PROVIDER_ID;
    setSelectedProviderId(preferred);
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderId || typeof globalThis === "undefined") {
      return;
    }

    globalThis.localStorage.setItem("selected-provider", selectedProviderId);
  }, [selectedProviderId]);

  useEffect(() => {
    if (!browserProviderAdapter) {
      setBrowserProviderAuthState("unknown");
      return;
    }

    void refreshBrowserProviderAuthState();
  }, [browserProviderAdapter, refreshBrowserProviderAuthState]);


  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);


  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(releaseAttachmentPreview);
    };
  }, []);

  // Smart auto-scroll: scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    if (stickToBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      // Mantém a referência em dia para que o `scroll` disparado por esta
      // escrita não seja lido como rolagem do usuário.
      lastScrollTopRef.current = viewport.scrollTop;
    }
  }, [messages]);

  // Detect if user scrolled up
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      stickToBottomRef.current = resolveStickToBottom({
        clientHeight: viewport.clientHeight,
        previousScrollTop: lastScrollTopRef.current,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
        sticking: stickToBottomRef.current,
      });
      lastScrollTopRef.current = viewport.scrollTop;
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  async function saveCredentials() {
    if (!selectedProvider) {
      return;
    }

    const requiredKeys = selectedProvider.requiredKeys ?? [];
    if (requiredKeys.some((field) => !credentialValues[field.envName]?.trim())) {
      toast.error("Preencha todas as credenciais do provider.");
      return;
    }

    setSavingCredentials(true);
    try {
      const result = await saveProviderCredentials(selectedProvider, credentialValues);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      await refreshCredentials();
      setCredentialDialogOpen(false);
      setCredentialValues({});
      toast.success(`Credenciais salvas para ${selectedProvider.label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar credenciais.");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function clearCredentials() {
    if (!selectedProvider) {
      return;
    }

    try {
      const ids = providerCredentialIds(selectedProvider.id, credentials);
      await Promise.all(ids.map((id) => apiJsonRequest(`/user/credentials/${id}`, "DELETE")));
      await refreshCredentials();
      setCredentialDialogOpen(false);
      toast.success(`Credenciais removidas de ${selectedProvider.label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao limpar credenciais.");
    }
  }

  async function ensureConversationId(titleSeed: string) {
    if (activeConversationId) {
      return activeConversationId;
    }

    const response = await apiJsonRequest<{
      conversation: { id: string };
    }>("/conversations", "POST", {
      modelId: selectedModelId || undefined,
      projectId: activeProjectId ?? undefined,
      providerId: selectedProviderId || undefined,
      title: titleSeed || "Nova conversa",
    });

    setActiveConversationId(response.conversation.id);
    setSidebarRefreshKey((current) => current + 1);
    return response.conversation.id;
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !selectedProvider) return;

    if (!selectedProviderReady) {
      setCredentialDialogOpen(true);
      return;
    }

    if (selectedProvider.hasModels && !selectedModelId) {
      toast.error("Selecione um modelo antes de anexar arquivos.");
      return;
    }

    const { accepted, errors } = validateFileSelection(
      Array.from(files),
      attachments.map((attachment) => ({ kind: attachment.kind, size: attachment.byteSize })),
      { allowImages: allowImageAttachments, allowDocuments: allowDocumentAttachments },
    );
    errors.forEach((message) => toast.error(message));

    const uploadQueue: Array<{ file: File; kind: AttachmentKind; previewUrl?: string }> = accepted.map(
      ({ file, kind }) => ({
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
      }),
    );

    if (uploadQueue.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    let conversationId: string;
    try {
      conversationId = await ensureConversationId(input.trim() || uploadQueue[0]?.file.name || "Nova conversa");
    } catch (error) {
      uploadQueue.forEach((entry) => {
        if (entry.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(entry.previewUrl);
        }
      });
      toast.error(error instanceof Error ? error.message : "Falha ao preparar a conversa para upload.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
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
    }));

    setAttachments((current) => [...current, ...tempAttachments]);

    for (const [index, tempAttachment] of tempAttachments.entries()) {
      const source = uploadQueue[index];
      if (!source) {
        continue;
      }

      try {
        const formData = new FormData();
        formData.append("file", source.file);
        const uploaded = await apiJson<{ attachment: ConversationAttachmentDescriptor }>(
          `/conversations/${conversationId}/attachments`,
          { body: formData, method: "POST" },
        );

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
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Falha ao enviar ${tempAttachment.fileName}.`);
        setAttachments((current) => {
          const target = current.find((attachment) => attachment.id === tempAttachment.id);
          if (target) {
            releaseAttachmentPreview(target);
          }
          return current.filter((attachment) => attachment.id !== tempAttachment.id);
        });
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      if (target) {
        releaseAttachmentPreview(target);
      }
      return prev.filter((attachment) => attachment.id !== id);
    });
  }

  const handleNewChat = useCallback(() => {
    attachmentsRef.current.forEach(releaseAttachmentPreview);
    setActiveConversationId(null);
    setMessages([]);
    setConversation([]);
    setInput("");
    setEditingMessageId(null);
    setAttachments([]);
    setTemporaryChat(false);
    setActiveCanvas(null);
    setCanvasPanelOpen(false);
  }, []);

  // Stop generation
  const handleStopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setPending(false);
  }, []);

  // Copy message content
  const handleCopyMessage = useCallback((messageId: string, content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    });
  }, []);

  // Toggle reaction on a message
  async function handleReaction(messageId: string, type: "thumbs_up" | "thumbs_down") {
    if (!activeConversationId) return;
    const current = reactions[messageId];
    // Optimistic update
    setReactions((prev) => ({ ...prev, [messageId]: current === type ? null : type }));
    try {
      await apiJsonRequest(`/conversations/${activeConversationId}/messages/${messageId}/reaction`, "POST", { type });
    } catch {
      // Revert on failure
      setReactions((prev) => ({ ...prev, [messageId]: current ?? null }));
    }
  }

  const handleSelectConversation = useCallback(async (id: string) => {
    try {
      const data = await apiJson<{
        messages: PersistedConversationMessage[];
        conversation: { providerId: string | null; modelId: string | null; projectId: string | null };
      }>(`/conversations/${id}/messages`);
      const persistedAssistantModelLabel = resolveAssistantModelLabel({
        modelId: data.conversation.modelId ?? undefined,
        models: [],
        providerLabel: providers.find((provider) => provider.id === data.conversation.providerId)?.label,
      });

      attachmentsRef.current.forEach(releaseAttachmentPreview);
      setActiveConversationId(id);
      setAttachments([]);
      setActiveProjectId(data.conversation.projectId ?? null);
      setMessages(data.messages.map((message) => hydrateChatMessage({
        assistantModelLabel: persistedAssistantModelLabel,
        message,
      })));
      setConversation(
        data.messages.map((message) => ({
          id: message.id,
          parts: message.parts,
          role: message.role,
        })),
      );

      // Abre o canvas mais recente da conversa (se houver) sem forçar foco.
      listCanvases(id)
        .then((canvases) => {
          if (canvases.length > 0) {
            return getCanvas(canvases[0]!.id);
          }
          return null;
        })
        .then((canvas) => {
          if (canvas) setActiveCanvas(canvas);
        })
        .catch(() => {
          // Canvas é opcional ao abrir conversa
        });

      // Restore provider/model if available
      if (data.conversation.providerId) {
        setSelectedProviderId(data.conversation.providerId);
      }
      if (data.conversation.modelId) {
        setSelectedModelId(data.conversation.modelId);
      }
    } catch {
      toast.error("Falha ao carregar conversa.");
    }
  }, [providers, setSelectedModelId]);

  function updateAssistantToolCall(
    assistantMessageId: string,
    toolCall: ParsedToolCall,
  ) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== assistantMessageId) {
          return message;
        }

        const existingIndex = message.toolCalls.findIndex((item) => item.toolCallId === toolCall.toolCallId);
        if (existingIndex === -1) {
          return {
            ...message,
            toolCalls: [...message.toolCalls, toolCall],
          };
        }

        const nextToolCalls = [...message.toolCalls];
        nextToolCalls[existingIndex] = {
          ...nextToolCalls[existingIndex],
          ...toolCall,
        };
        return {
          ...message,
          toolCalls: nextToolCalls,
        };
      }),
    );
  }

  async function sendMessage(options?: {
    baseConversation?: ConversationMessage[];
    overrideAttachments?: HydratedAttachmentPart[];
    overrideText?: string;
  }) {
    const text = (options?.overrideText ?? input).trim();
    const currentAttachments = options?.overrideAttachments ?? attachments.filter((attachment) => attachment.status === "uploaded").map((attachment) => ({
      ...attachment,
      attachmentId: attachment.id,
      type: "attachment" as const,
    }));
    const hasAttachments = currentAttachments.length > 0;
    const hasPendingComposerAttachments = attachments.some((attachment) => attachment.status === "uploading");
    if ((!text && !hasAttachments) || pending || !selectedProvider) {
      return;
    }

    if (!options?.overrideAttachments && hasPendingComposerAttachments) {
      toast.error("Aguarde o processamento dos anexos antes de enviar.");
      return;
    }

    if (!selectedProviderReady) {
      setCredentialDialogOpen(true);
      return;
    }

    if (selectedProvider.hasModels && !selectedModelId) {
      toast.error("Selecione um modelo.");
      return;
    }

    const compatibilityError = validateAttachmentCompatibility(
      currentAttachments,
      { allowImages: allowImageAttachments, allowDocuments: allowDocumentAttachments },
      selectedProvider.label,
      browserProviderAdapter?.attachments,
    );
    if (compatibilityError) {
      toast.error(compatibilityError);
      return;
    }

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const assistantModelLabel = resolveAssistantModelLabel({
      modelId: selectedProvider.hasModels ? selectedModelId : undefined,
      models,
      providerLabel: selectedProvider.label,
    });

    const messageParts = buildUserMessageParts(text, currentAttachments.map((attachment) => ({
      byteSize: attachment.byteSize,
      contentUrl: attachment.contentUrl,
      extractionStatus: attachment.extractionStatus,
      fileName: attachment.fileName,
      id: attachment.attachmentId,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
    })));
    const baseConversation = options?.baseConversation ?? conversation;
    const nextConversation: ConversationMessage[] = [
      ...baseConversation,
      {
        id: userMessageId,
        parts: messageParts,
        role: "user" as const,
      },
    ];

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
        : null;
    // Intenção explícita de canvas: instrui o modelo a produzir formato elegível
    const canvasIntent = shouldRequestCanvasGuidance(text);
    const canvasGuidanceMessage: ConversationMessage | null = canvasIntent
      ? {
          id: crypto.randomUUID(),
          parts: [{ text: CANVAS_ASSISTANT_GUIDANCE, type: "text" as const }],
          role: "user" as const,
        }
      : null;
    const contextualPrepend: ConversationMessage[] = [
      ...(canvasGuidanceMessage ? [canvasGuidanceMessage] : []),
      ...(canvasContextMessage ? [canvasContextMessage] : []),
    ];
    const messagesToSend: ConversationMessage[] = contextualPrepend.length > 0
      ? [...nextConversation.slice(0, -1), ...contextualPrepend, nextConversation.at(-1)!]
      : nextConversation;
    const projectHeaders: Record<string, string> = activeProjectId
      ? { [MODELHUB_PROJECT_HEADER]: activeProjectId }
      : {};

    const maxOutputTokens = resolveMaxOutputTokens({
      model: selectedModel,
      modelId: selectedModelId,
      providerId: selectedProvider.id,
    });
    const requestPayload = {
      id: crypto.randomUUID(),
      max_tokens: maxOutputTokens,
      messages: nextConversation,
      modelId: selectedProvider.hasModels ? selectedModelId : undefined,
      trigger: "submit-message",
    };


    const estimatedPayloadBytes = estimateSerializedPayloadBytes(requestPayload);
    if (estimatedPayloadBytes > MAX_SERIALIZED_CHAT_REQUEST_BYTES) {
      toast.error(
        `Mensagem muito grande para o runtime serverless. Reduza texto/anexos para ficar abaixo de ${formatBytes(MAX_SERIALIZED_CHAT_REQUEST_BYTES)} por request.`,
      );
      return;
    }

    setConversation(nextConversation);
    setMessages((current) => [
      ...(options?.baseConversation ? current.slice(0, options.baseConversation.length) : current),
      { content: text, createdAt: new Date().toISOString(), id: userMessageId, parts: messageParts, role: "user", toolCalls: [] },
      {
        content: "",
        createdAt: new Date().toISOString(),
        id: assistantMessageId,
        modelLabel: assistantModelLabel,
        role: "assistant",
        toolCalls: [],
      },
    ]);
    if (!options?.overrideAttachments) {
      attachmentsRef.current.forEach(releaseAttachmentPreview);
      setInput("");
      setAttachments([]);
    }
    setPending(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let fullText = "";
      let effectiveModelLabel = assistantModelLabel;
      if (browserProviderAdapter) {
        if (browserProviderAuthState !== "signed-in") {
          setBrowserProviderAuthState("loading");
          await browserProviderAdapter.auth.signIn();
          setBrowserProviderAuthState("signed-in");
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
            );
          },
        });
        setBrowserProviderAuthState("signed-in");
      } else {
      let parsedStream: Awaited<ReturnType<typeof parseChatStream>> | null = null;
      const response = await apiFetch(
        selectedProviderId === AUTO_PROVIDER_ID ? "/v1/chat/completions" : `${selectedProvider.base}/api/chat`,
        {
          body: JSON.stringify(
            selectedProviderId === AUTO_PROVIDER_ID
              ? { max_tokens: requestPayload.max_tokens, messages: messagesToSend, model: selectedModelId }
              : { ...requestPayload, messages: messagesToSend },
          ),
          headers: {
            "Content-Type": "application/json",
            ...projectHeaders,
          },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorMessage = await parseApiErrorResponse(response);
        const requestError = new Error(errorMessage) as ChatRequestError;
        requestError.status = response.status;
        requestError.suppressToast = selectedProviderId === "duckai" && response.status === 503;
        throw requestError;
      }

      const { resolvedLabel: resolvedAssistantLabel, fallbackMeta: modelFallbackMeta } =
        resolveModelFallbackFromHeaders(response, assistantModelLabel, models, selectedProvider.label);

      effectiveModelLabel = resolvedAssistantLabel ?? assistantModelLabel;

      setMessages((current) =>
        current.map((message) => {
          if (message.id !== assistantMessageId) {
            return message;
          }
          const next: ChatMessage = {
            ...message,
            modelLabel: resolvedAssistantLabel,
          };
          if (modelFallbackMeta) {
            next.modelFallbackMeta = modelFallbackMeta;
          } else {
            delete next.modelFallbackMeta;
          }
          return next;
        }),
      );

      const toolMap = new Map<string, ParsedToolCall>();
      parsedStream = await parseChatStream(response, {
        onTextDelta(delta) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: `${message.content}${delta}` }
                : message,
            ),
          );
        },
        onToolResult(toolCallId, result) {
          const existing = toolMap.get(toolCallId);
          if (!existing) {
            return;
          }

          const updated: ParsedToolCall = { ...existing, result, status: "completed" };
          toolMap.set(toolCallId, updated);
          updateAssistantToolCall(assistantMessageId, updated);
        },
        onToolStart(toolCall) {
          toolMap.set(toolCall.toolCallId, toolCall);
          updateAssistantToolCall(assistantMessageId, toolCall);
        },
      });

      if (!parsedStream) {
        throw new Error("Nenhum stream recebido.");
      }
      fullText = parsedStream.text;

      if (parsedStream.finishReason === "length") {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, truncated: true } : message,
          ),
        );
      }

      const errorContent = resolveStreamErrorContent(parsedStream, fullText, selectedProviderId);
      if (errorContent) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: errorContent, isError: true }
              : message,
          ),
        );
        return;
      }
      }

      if (fullText) {
        // Detecção de canvas (client-side, pós-stream — spec v2)
        let assistantParts: HydratedConversationMessagePart[] = [{ text: fullText, type: "text" }];
        let displayContent = fullText;
        let convIdEarly = activeConversationId;
        let createdConversation = false;

        const suggestion = temporaryChat
          ? null
          : detectCanvas(fullText, { explicitIntent: canvasIntent });
        if (suggestion) {
          try {
            if (!convIdEarly) {
              convIdEarly = await ensureConversationId(
                text || currentAttachments[0]?.fileName || suggestion.title,
              );
              createdConversation = true;
            }
            const activeInConversation =
              activeCanvas && activeCanvas.conversationId === convIdEarly;
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
                });
            setActiveCanvas(canvas);
            setCanvasPanelOpen(true);
            displayContent = buildDisplayText(fullText, suggestion);
            const canvasPart: CanvasReferencePart = {
              canvasId: canvas.id,
              kind: canvas.kind,
              title: canvas.title,
              type: "canvas",
            };
            assistantParts = displayContent
              ? [{ text: displayContent, type: "text" }, canvasPart]
              : [canvasPart];
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: displayContent, parts: assistantParts }
                  : message,
              ),
            );
          } catch (error) {
            // Canvas é best-effort (a resposta permanece íntegra), mas o erro
            // precisa ser visível para diagnóstico em produção.
            console.error("[canvas] falha ao criar/atualizar canvas", error);
            toast.error(
              `Falha ao abrir o Canvas: ${error instanceof Error ? error.message : "erro desconhecido"}`,
            );
          }
        }

        setConversation((current) => [
          ...current,
          {
            id: assistantMessageId,
            parts: assistantParts,
            role: "assistant",
          },
        ]);

        // Persist conversation (skip in temporary chat mode)
        if (!temporaryChat) try {
          let convId = convIdEarly;
          let isNewConversation = createdConversation;
          if (!convId) {
            convId = await ensureConversationId(text || currentAttachments[0]?.fileName || "Nova conversa");
            isNewConversation = true;
          }
          const persisted = await persistMessagesForConversation(convId, [
            { parts: messageParts, role: "user" },
            { content: displayContent, modelLabel: effectiveModelLabel, parts: assistantParts, role: "assistant" },
          ]);
          const [persistedUserMessage, persistedAssistantMessage] = persisted.messages;
          if (persistedUserMessage && persistedAssistantMessage) {
            setConversation((current) =>
              current.map((message) => {
                if (message.id === userMessageId) {
                  return {
                    id: persistedUserMessage.id,
                    parts: persistedUserMessage.parts,
                    role: persistedUserMessage.role,
                  };
                }

                if (message.id === assistantMessageId) {
                  return {
                    id: persistedAssistantMessage.id,
                    parts: persistedAssistantMessage.parts,
                    role: persistedAssistantMessage.role,
                  };
                }

                return message;
              }),
            );
            setMessages((current) =>
              current.map((message) => {
                if (message.id === userMessageId) {
                  return hydrateChatMessage({ message: persistedUserMessage });
                }

                if (message.id === assistantMessageId) {
                  return {
                    ...message,
                    content: persistedAssistantMessage.content,
                    id: persistedAssistantMessage.id,
                  };
                }

                return message;
              }),
            );
          }
          setSidebarRefreshKey((k) => k + 1);

          // Generate AI title for new conversations (fire-and-forget)
          if (
            isNewConversation &&
            selectedProvider &&
            browserProviderAdapter?.titleGeneration !== "unsupported"
          ) {
            const titleConvId = convId;
            void (async () => {
              try {
                const titleMessages = [
                  {
                    role: "user",
                    parts: [{ type: "text", text: buildTitleGenerationPrompt(text, fullText) }],
                  },
                ];
                const titleResponse = await apiFetch(
                  selectedProviderId === AUTO_PROVIDER_ID ? "/v1/chat/completions" : `${selectedProvider.base}/api/chat`,
                  {
                    body: JSON.stringify(
                      selectedProviderId === AUTO_PROVIDER_ID
                        ? { messages: titleMessages, model: selectedModelId }
                        : {
                            messages: titleMessages,
                            modelId: selectedProvider.hasModels ? selectedModelId : undefined,
                          },
                    ),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                  },
                );
                if (titleResponse.ok) {
                  const titleResult = await parseChatStream(titleResponse, {});
                  const cleanTitle = titleResult.text.trim().replaceAll(/^["']|["']$/g, "").slice(0, 100);
                  if (cleanTitle) {
                    await apiJsonRequest(`/conversations/${titleConvId}`, "PATCH", { title: cleanTitle });
                    setSidebarRefreshKey((k) => k + 1);
                  }
                }
              } catch {
                // Title generation failure is non-blocking
              }
            })();
          }
        } catch {
          // Persistence failure is non-blocking
        }
      }
    } catch (error) {
      // Don't show error for user-initiated abort
      if (error instanceof DOMException && error.name === "AbortError") {
        // Keep whatever text was streamed so far
        return;
      }

      const requestError = error as ChatRequestError;
      if (browserProviderAdapter) {
        setBrowserProviderAuthState("signed-out");
      }
      let errorMsg: string;
      if (requestError.suppressToast) {
        errorMsg = DUCKAI_TEMPORARY_INLINE_MESSAGE;
      } else if (error instanceof Error) {
        errorMsg = `Erro: ${error.message}`;
      } else {
        errorMsg = "Erro ao enviar mensagem.";
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: errorMsg, isError: true }
            : message,
        ),
      );
      if (!requestError.suppressToast) {
        toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
      }
    } finally {
      setPending(false);
      abortControllerRef.current = null;
    }
  }

  // Regenerate last assistant response
  async function handleRegenerate() {
    if (pending || !selectedProvider || messages.length < 2) return;

    const lastUserMsgIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserMsgIndex === -1) return;

    const lastUserMsg = messages[lastUserMsgIndex];
    const regenerateText = getUserMessageText(lastUserMsg);
    const regenerateAttachments = (lastUserMsg.parts ?? []).filter(isHydratedAttachmentPart);
    const conversationUserIndex = conversation.findIndex((entry) => entry.id === lastUserMsg.id);
    const baseConversation = conversationUserIndex >= 0 ? conversation.slice(0, conversationUserIndex) : conversation.slice(0, lastUserMsgIndex);
    const lastAssistantMessage = messages.at(-1);

    if (activeConversationId && lastAssistantMessage?.role === "assistant") {
      try {
        await trimConversation(activeConversationId, { fromMessageId: lastAssistantMessage.id });
      } catch {
        toast.error("Falha ao preparar a conversa para regeneracao.");
        return;
      }
    }

    setMessages((current) => current.slice(0, lastUserMsgIndex));
    setConversation(baseConversation);
    void sendMessage({
      baseConversation,
      overrideAttachments: regenerateAttachments,
      overrideText: regenerateText,
    });
  }

  // Share conversation
  async function handleShareConversation() {
    if (!activeConversationId) return;
    try {
      const data = await apiJsonRequest<{ shareToken: string }>(
        `/conversations/${activeConversationId}/share`,
        "POST",
      );
      const shareUrl = `${globalThis.location.origin}/share/${data.shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link de compartilhamento copiado!");
    } catch {
      toast.error("Falha ao gerar link de compartilhamento.");
    }
  }

  // Converte manualmente uma resposta existente em Canvas.
  // Útil para mensagens anteriores à detecção automática ou respostas de modelos
  // que produziram um fence menor que os limiares normais.
  async function handleOpenMessageInCanvas(message: ChatMessage) {
    if (message.role !== "assistant" || !message.content.trim()) return;

    try {
      const convId = activeConversationId ?? await ensureConversationId("Canvas");
      const suggestion = detectCanvas(message.content, { explicitIntent: true });
      const fallbackTitle = message.content
        .split("\n")
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .find(Boolean)
        ?.slice(0, 60) || "Canvas";
      const candidate = suggestion ?? {
        content: message.content,
        kind: "markdown" as const,
        language: null,
        title: fallbackTitle,
      };
      const canvas = await createCanvas(convId, {
        content: candidate.content,
        kind: candidate.kind,
        language: candidate.language,
        title: candidate.title,
      });
      const canvasPart: CanvasReferencePart = {
        canvasId: canvas.id,
        kind: canvas.kind,
        title: canvas.title,
        type: "canvas",
      };
      const displayContent = suggestion
        ? buildDisplayText(message.content, suggestion)
        : message.content;

      setActiveCanvas(canvas);
      setCanvasPanelOpen(true);
      setMessages((current) => current.map((entry) =>
        entry.id === message.id
          ? {
              ...entry,
              content: displayContent,
              parts: [
                ...(entry.parts?.filter((part) => part.type !== "canvas") ?? []),
                canvasPart,
              ],
            }
          : entry,
      ));
      toast.success("Canvas aberto.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao abrir o Canvas.");
    }
  }

  // Continue generation — send "Continue" as a follow-up to get the model to keep going
  async function handleContinueGeneration() {
    if (pending || !selectedProvider) return;
    void sendMessage({ overrideText: "Continue" });
  }

  // Edit a user message and re-send
  function handleStartEdit(messageId: string, content: string) {
    setEditingMessageId(messageId);
    setEditingContent(content);
  }

  function handleCancelEdit() {
    setEditingMessageId(null);
    setEditingContent("");
  }

  async function handleSubmitEdit(messageId: string) {
    if (!editingContent.trim() || pending) return;

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const editText = editingContent.trim();
    const editedMessage = messages[msgIndex];
    const editedAttachments = (editedMessage.parts ?? []).filter(isHydratedAttachmentPart);
    const convIndex = conversation.findIndex((item) => item.id === messageId);
    const baseConversation = convIndex >= 0 ? conversation.slice(0, convIndex) : conversation.slice(0, msgIndex);

    if (activeConversationId) {
      try {
        await trimConversation(activeConversationId, { fromMessageId: messageId });
      } catch {
        toast.error("Falha ao atualizar a conversa antes da edicao.");
        return;
      }
    }

    setMessages((current) => current.slice(0, msgIndex));
    setConversation(baseConversation);

    setEditingMessageId(null);
    setEditingContent("");

    void sendMessage({
      baseConversation,
      overrideAttachments: editedAttachments,
      overrideText: editText,
    });
  }


  // Export conversation
  function getExportableContent(m: ChatMessage): string {
    return m.role === "user" && m.parts?.length
      ? createMessageContentFallback(m.parts)
      : m.content;
  }

  function handleExportMarkdown() {
    if (messages.length === 0) return;

    const mdContent = conversationToMarkdown(
      null,
      messages.map((m) => ({ content: getExportableContent(m), role: m.role })),
    );

    downloadTextFile(buildExportFilename(null, "md"), "text/markdown", mdContent);
    toast.success("Conversa exportada como Markdown.");
  }

  function handleExportJson() {
    if (messages.length === 0) return;

    const jsonContent = conversationToJson(
      null,
      messages.map((m) => ({
        content: getExportableContent(m),
        createdAt: m.createdAt ?? null,
        id: m.id,
        modelLabel: m.modelLabel ?? null,
        role: m.role,
      })),
    );

    downloadTextFile(buildExportFilename(null, "json"), "application/json", jsonContent);
    toast.success("Conversa exportada como JSON.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Toolbar: provider/modelo rolam horizontalmente; as ações ficam fixas à direita */}
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2 md:px-4">
        <div className="flex min-w-0 flex-1 touch-pan-x flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1.5 [scrollbar-width:thin]">
          <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
            <SelectTrigger className="h-8 w-auto max-w-[min(200px,55vw)] shrink-0 text-xs sm:min-w-[140px] sm:max-w-[200px]">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Roteamento</SelectLabel>
                <SelectItem value={AUTO_PROVIDER_ID}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">ModelHub</span>
                    <SparklesIcon className="size-3 shrink-0 text-primary" aria-label="Smart Routing" />
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
              {configuredProvidersWithApiKey.length > 0 ? <SelectSeparator /> : null}
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
              {providersWithBrowserSession.length > 0 ? <SelectSeparator /> : null}
              {unconfiguredProvidersWithApiKey.length > 0 ? <SelectSeparator /> : null}
              {unconfiguredProvidersWithApiKey.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Com chave de API</SelectLabel>
                  {unconfiguredProvidersWithApiKey.map((provider) => {
                    const check = showConfiguredCheck(provider);
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
                    );
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
              disabled={!selectedProvider?.hasModels || !selectedProviderReady || models.length === 0}
            >
              <SelectTrigger className="h-8 w-auto max-w-[min(240px,60vw)] shrink-0 text-xs sm:min-w-[140px] sm:max-w-[240px]">
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
                          <Badge variant="secondary" className="h-4 px-1 py-0 text-[9px] leading-none">Raciocínio</Badge>
                        )}
                        {model.capabilities.fast && (
                          <Badge variant="outline" className="h-4 px-1 py-0 text-[9px] leading-none text-green-600 border-green-500/40">Rápido</Badge>
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
                  browserProviderAdapter && browserProviderAuthState !== "signed-in"
                    ? "secondary"
                    : selectedProviderReady
                      ? "outline"
                      : "destructive"
                }
                className="shrink-0 whitespace-nowrap text-xs"
              >
                {browserProviderAdapter ? (
                  browserProviderAuthState === "loading"
                    ? "Conectando..."
                    : browserProviderAuthState === "signed-in"
                      ? "Sessao conectada"
                      : "Login necessario"
                ) : selectedProviderReady ? (
                  "Conectado"
                ) : (
                  <>
                    <span className="sm:hidden">Pendente</span>
                    <span className="hidden sm:inline">Credenciais pendentes</span>
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
                  {browserProviderAuthState === "signed-in" ? "Sessão conectada" : "Entrar no provider"}
                </DropdownMenuItem>
              ) : null}

              {providerUsesStoredCredentials(selectedProvider) && !selectedProviderReady ? (
                <DropdownMenuItem onSelect={() => setCredentialDialogOpen(true)}>
                  <Settings2Icon />
                  Configurar credenciais
                </DropdownMenuItem>
              ) : null}

              {browserProviderAdapter ||
              (providerUsesStoredCredentials(selectedProvider) && !selectedProviderReady) ? (
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
                <DropdownMenuItem onSelect={() => void handleShareConversation()}>
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
      {!selectedProviderReady && selectedProvider && providerUsesStoredCredentials(selectedProvider) ? (
        <div className="shrink-0 px-3 pt-3 md:px-4">
          <Alert>
            <KeyRoundIcon data-icon="inline-start" />
            <AlertTitle>{selectedProvider.label} exige credenciais</AlertTitle>
            <AlertDescription>
              Salve as chaves necessárias antes de carregar modelos ou enviar mensagens.
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
                    Escolha um provider e um modelo, ou use uma sugestão abaixo para reduzir a barreira de entrada.
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
                  {message.role === "user" ? <UserIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
                </div>
                <div className="flex max-w-[85%] flex-col gap-1 sm:max-w-[75%]">
                  {message.role === "assistant" && message.modelFallbackMeta ? (
                    <Alert className="border-amber-500/40 bg-amber-500/10 py-2 text-amber-950 dark:text-amber-50">
                      <AlertTitle className="text-xs font-semibold">Modelo diferente do que você selecionou</AlertTitle>
                      <AlertDescription className="text-xs leading-relaxed text-amber-950/90 dark:text-amber-50/90">
                        A API não aceitou{" "}
                        <span className="font-medium text-foreground">
                          {message.modelFallbackMeta.requestedLabel}
                        </span>{" "}
                        nesta requisição (por exemplo{" "}
                        <code className="rounded bg-background/80 px-1 py-0.5 text-[11px]">model_not_found</code> ou
                        sem acesso). O backend tentou, nesta ordem:{" "}
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
                      message.isError && "border border-destructive/30 bg-destructive/10",
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
                              e.preventDefault();
                              void handleSubmitEdit(message.id);
                            }
                            if (e.key === "Escape") handleCancelEdit();
                          }}
                        />
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => void handleSubmitEdit(message.id)}>
                            Enviar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancelEdit}>
                            <XIcon className="size-3" /> Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : message.role === "assistant" ? (
                      message.content || message.parts?.some((part) => part.type === "canvas") ? (
                        <>
                          {message.content ? (
                            <div className="min-w-0 max-w-full overflow-hidden prose-sm">
                              <MarkdownRenderer content={message.content} />
                              {/* Blinking cursor during streaming */}
                              {pending && messageIndex === messages.length - 1 && !message.isError && (
                                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/70" />
                              )}
                            </div>
                          ) : null}
                          {message.parts
                            ?.filter((part): part is CanvasReferencePart => part.type === "canvas")
                            .map((part) => (
                              <CanvasMessageCard
                                key={part.canvasId}
                                onOpen={() => void openCanvasById(part.canvasId)}
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
                            <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                            <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
                          </span>
                        </div>
                      )
                    ) : (message.content || message.parts?.length) ? (
                      <div className="flex flex-col gap-2">
                        {message.content ? <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p> : null}
                        {message.parts?.filter(isHydratedAttachmentPart).length ? (
                          <div className="flex flex-wrap gap-2">
                            {message.parts.filter(isHydratedAttachmentPart).map((part) =>
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
                                    <p className="truncate text-xs font-medium">{part.fileName}</p>
                                    <p className="text-[10px] text-primary-foreground/75">
                                      {buildAttachmentLabel(part)} · {formatBytes(part.byteSize)}
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
                        <span>Gerando resposta</span>
                        <span className="inline-flex gap-0.5">
                          <span className="animate-bounce delay-0">.</span>
                          <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                          <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
                        </span>
                      </div>
                    )}

                    {message.toolCalls.length > 0 ? (
                      <div className="mt-2 flex flex-col gap-2 border-t border-border/30 pt-2">
                        {message.toolCalls.map((toolCall) => (
                          <div key={toolCall.toolCallId} className="rounded-lg bg-background/50 p-2.5">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">{toolCall.toolName}</span>
                              <Badge
                                variant={toolCall.status === "completed" ? "secondary" : toolCall.status === "pending-approval" ? "destructive" : "outline"}
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
                                { args: toolCall.args, result: toolCall.result ?? null },
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {(message.createdAt || (message.role === "assistant" && message.modelLabel)) && (
                    <p className="px-1 text-[10px] text-muted-foreground/60">
                      {message.createdAt && formatMessageTimestamp(message.createdAt)}
                      {message.createdAt && message.role === "assistant" && message.modelLabel ? " - " : ""}
                      {message.role === "assistant" && message.modelLabel && message.modelLabel}
                    </p>
                  )}

                  {/* Action buttons below the bubble */}
                  {editingMessageId !== message.id && (message.content || message.parts?.length) && !pending && (
                    <div className={cn(
                      // No touch (sem hover) as ações ficam sempre visíveis; no desktop aparecem ao passar o mouse
                      "flex gap-1 opacity-100 transition-opacity md:gap-0.5 md:opacity-0 md:group-hover/msg:opacity-100",
                      message.role === "user" ? "flex-row-reverse" : "flex-row",
                    )}>
                      {/* Copy */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-8 md:size-6"
                        onClick={() => handleCopyMessage(message.id, message.role === "user" ? getUserMessageText(message) : message.content)}
                        title="Copiar mensagem"
                      >
                        {copiedMessageId === message.id ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
                      </Button>

                      {/* Edit (user only) */}
                      {message.role === "user" && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-8 md:size-6"
                          onClick={() => handleStartEdit(message.id, getUserMessageText(message))}
                          title="Editar mensagem"
                        >
                          <PencilIcon className="size-3" />
                        </Button>
                      )}

                      {/* Reactions (assistant only) */}
                      {message.role === "assistant" && !message.isError && (
                        <>
                          <Button
                            variant={reactions[message.id] === "thumbs_up" ? "default" : "ghost"}
                            size="icon-xs"
                            className="size-8 md:size-6"
                            onClick={() => void handleReaction(message.id, "thumbs_up")}
                            title="Boa resposta"
                          >
                            <ThumbsUpIcon className="size-3" />
                          </Button>
                          <Button
                            variant={reactions[message.id] === "thumbs_down" ? "default" : "ghost"}
                            size="icon-xs"
                            className="size-8 md:size-6"
                            onClick={() => void handleReaction(message.id, "thumbs_down")}
                            title="Resposta ruim"
                          >
                            <ThumbsDownIcon className="size-3" />
                          </Button>
                        </>
                      )}

                      {/* Abrir uma resposta existente no Canvas */}
                      {message.role === "assistant" &&
                        !message.isError &&
                        message.content.trim().length >= 40 &&
                        !message.parts?.some((part) => part.type === "canvas") ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs md:h-6 md:text-[10px]"
                            onClick={() => void handleOpenMessageInCanvas(message)}
                            title="Abrir esta resposta no Canvas"
                          >
                            <FrameIcon className="size-3" />
                            Canvas
                          </Button>
                        ) : null}

                      {/* Regenerate (last assistant only) */}
                      {message.role === "assistant" && messageIndex === messages.length - 1 && (
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
                      {message.role === "assistant" && messageIndex === messages.length - 1 && message.truncated && !message.isError && message.content && (
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
                          <RefreshCwIcon className="size-3" /> Tentar novamente
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
                    {att.status === "uploading" ? "Processando..." : buildAttachmentLabel(att)}
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
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Pergunte algo..."
              // text-base (16px) no mobile evita o zoom automático do Safari iOS ao focar
              className="min-h-[2.25rem] text-base md:text-sm"
            />
            <InputGroupAddon align="block-end" className="justify-between gap-2 border-t px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-8 md:size-6"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={
                          pending ||
                          (!allowImageAttachments && !allowDocumentAttachments)
                        }
                      >
                        <PaperclipIcon className="size-3" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Limites: {formatBytes(MAX_ATTACHMENT_FILE_BYTES)} por imagem, {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} em imagens, {formatBytes(MAX_DOCUMENT_ATTACHMENT_FILE_BYTES)} por documento, {formatBytes(MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES)} em documentos e {formatBytes(MAX_SERIALIZED_CHAT_REQUEST_BYTES)} por request.
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
                      className="h-7 w-auto max-w-[150px] shrink-0 border-dashed text-[11px]"
                      title="Projeto do contexto da conversa"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem projeto</SelectItem>
                      {projectOptions.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          <span className="max-w-[180px] truncate">{project.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <InputGroupText className="max-w-[55vw] truncate text-xs sm:max-w-none">
                  {selectedProvider?.label ?? "Provider"}
                  {selectedModelId ? ` · ${models.find((model) => model.id === selectedModelId)?.name ?? selectedModelId}` : ""}
                </InputGroupText>
              </div>
              {pending ? (
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleStopGeneration}>
                  <SquareIcon className="size-3" />
                  <span className="hidden sm:inline">Parar</span>
                </Button>
              ) : (
                <InputGroupButton
                  size="sm"
                  disabled={(!input.trim() && attachments.length === 0) || composerHasUploadingAttachments}
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

      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
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
                      {selectedProvider.signupLabel ?? "Clique aqui para obter"}
                    </a>
                  </span>
                </div>
              )}
              <FieldGroup>
                {(selectedProvider.requiredKeys ?? []).map((field) => (
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
              <div className="flex flex-wrap gap-3">
                <Button disabled={savingCredentials} onClick={() => void saveCredentials()}>
                  {savingCredentials && <Loader2Icon className="size-3 animate-spin" />}
                  {savingCredentials ? "Testando conexão…" : "Salvar credenciais"}
                </Button>
                <Button variant="outline" disabled={savingCredentials} onClick={() => void clearCredentials()}>
                  Limpar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>

      {/* Painel do canvas — split-pane redimensionável no desktop, sheet no mobile */}
      {isMobile ? (
        <Sheet onOpenChange={setCanvasPanelOpen} open={canvasPanelOpen}>
          <SheetContent className="h-[92vh] w-full p-0 sm:max-w-full" side="bottom">
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
            className="group relative -left-1 z-10 w-2 shrink-0 cursor-col-resize"
            onPointerDown={beginCanvasResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar painel do canvas"
          >
            <div className="h-full w-full transition-colors group-hover:bg-primary/25" />
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
  );
}

const CANVAS_KIND_ICON_LABEL: Record<string, string> = {
  code: "Código",
  html: "HTML",
  markdown: "Documento",
  mermaid: "Diagrama",
  react: "React",
};

function CanvasMessageCard({
  onOpen,
  part,
}: {
  onOpen: () => void;
  part: CanvasReferencePart;
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
  );
}
