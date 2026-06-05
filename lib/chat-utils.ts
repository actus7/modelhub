import {
  MODELHUB_EFFECTIVE_MODEL_HEADER,
  MODELHUB_MODEL_FALLBACK_USED_HEADER,
  MODELHUB_MODELS_ATTEMPTED_HEADER,
  MODELHUB_REQUESTED_MODEL_HEADER,
  type ProviderModel,
} from "@/lib/contracts";
import {
  extractPlainTextFromParts,
  type AttachmentExtractionStatus,
  type AttachmentKind,
  type ConversationAttachmentDescriptor,
  type ConversationMessagePart,
  type HydratedAttachmentPart,
  type HydratedConversationMessagePart,
} from "@/lib/chat-parts";
import { apiJson, apiJsonRequest } from "@/lib/api";
import { type ParsedToolCall } from "@/lib/chat-stream";

export type ConversationMessage = {
  id: string;
  parts: HydratedConversationMessagePart[];
  role: "assistant" | "user";
};

export type ComposerAttachment = ConversationAttachmentDescriptor & {
  previewUrl?: string;
  status: "uploaded" | "uploading";
};

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const ACCEPTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type ChatMessage = {
  content: string;
  createdAt?: string;
  id: string;
  isError?: boolean;
  modelLabel?: string;
  /** Só preenchido quando o backend confirmou fallback (`x-modelhub-model-fallback-used: true`). */
  modelFallbackMeta?: {
    attemptedIds: string[];
    effectiveLabel: string;
    requestedLabel: string;
  };
  parts?: HydratedConversationMessagePart[];
  role: "assistant" | "user";
  toolCalls: ParsedToolCall[];
};

export type PersistedConversationMessage = {
  content: string;
  createdAt?: string;
  id: string;
  parts: HydratedConversationMessagePart[];
  role: "assistant" | "user";
};

export const DUCKAI_TEMPORARY_INLINE_MESSAGE = "Duck.ai temporariamente indisponível. Tente novamente em instantes.";
export const STREAM_INTERRUPTED_NOTE = "\n\n_Resposta interrompida. Tente novamente._";
export const EMPTY_STATE_PROMPTS = [
  "Resuma este projeto em tópicos.",
  "Compare dois providers para o meu caso.",
  "Escreva um prompt melhor para suporte.",
  "Me ajude a diagnosticar um erro 500.",
] as const;

export type ChatRequestError = Error & {
  status?: number;
  suppressToast?: boolean;
};

export async function parseApiErrorResponse(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (payload.error) {
      if (typeof payload.error === "string") return payload.error;
      if (typeof payload.error === "object" && payload.error !== null && "message" in payload.error) {
        return String((payload.error as { message: unknown }).message);
      }
      return JSON.stringify(payload.error);
    }
  } catch {
    // Keep fallback.
  }
  return `HTTP ${response.status}`;
}

export function resolveModelFallbackFromHeaders(
  response: Response,
  defaultLabel: string | undefined,
  models: ProviderModel[],
  providerLabel: string,
) {
  const effectiveModelId = response.headers.get(MODELHUB_EFFECTIVE_MODEL_HEADER)?.trim() ?? "";
  const requestedModel = response.headers.get(MODELHUB_REQUESTED_MODEL_HEADER)?.trim() ?? "";
  const fallbackUsed = response.headers.get(MODELHUB_MODEL_FALLBACK_USED_HEADER) === "true";
  const attemptedIds = (response.headers.get(MODELHUB_MODELS_ATTEMPTED_HEADER) ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const resolvedLabel = effectiveModelId.length > 0
    ? resolveAssistantModelLabel({ modelId: effectiveModelId, models, providerLabel })
    : defaultLabel;

  const fallbackMeta =
    fallbackUsed && requestedModel.length > 0 && effectiveModelId.length > 0 && attemptedIds.length > 0
      ? {
          requestedLabel: resolveAssistantModelLabel({ modelId: requestedModel, models, providerLabel }) ?? requestedModel,
          effectiveLabel: resolvedLabel ?? effectiveModelId,
          attemptedIds: [...attemptedIds],
        }
      : undefined;

  return { resolvedLabel, fallbackMeta };
}

export function resolveStreamErrorContent(
  parsedStream: { errorMessage?: string; hadPartialOutput: boolean; text: string },
  fullText: string,
  providerId: string,
): string | null {
  if (!parsedStream.errorMessage) return null;
  if (parsedStream.hadPartialOutput) return `${fullText}${STREAM_INTERRUPTED_NOTE}`;
  if (providerId === "duckai") return DUCKAI_TEMPORARY_INLINE_MESSAGE;
  return `Erro: ${parsedStream.errorMessage}`;
}

export function resolveAssistantModelLabel(input: {
  modelId?: string;
  models: ProviderModel[];
  providerLabel?: string;
}) {
  const modelName = input.modelId
    ? (input.models.find((model) => model.id === input.modelId)?.name ?? input.modelId)
    : null;

  if (modelName && input.providerLabel) {
    const trimmed = modelName.trim();
    const suffix = `(${input.providerLabel})`;
    if (trimmed.endsWith(suffix)) {
      return trimmed;
    }

    return `${trimmed} (${input.providerLabel})`;
  }

  return modelName ?? input.providerLabel;
}

export function isHydratedAttachmentPart(part: HydratedConversationMessagePart): part is HydratedAttachmentPart {
  return part.type === "attachment";
}

export function createTextPart(text: string): HydratedConversationMessagePart[] {
  return text ? [{ text, type: "text" }] : [];
}

export function buildUserMessageParts(
  text: string,
  attachments: ConversationAttachmentDescriptor[],
): HydratedConversationMessagePart[] {
  return [
    ...createTextPart(text),
    ...attachments.map((attachment) => ({
      ...attachment,
      attachmentId: attachment.id,
      type: "attachment" as const,
    })),
  ];
}

export function getUserMessageText(message: { parts?: HydratedConversationMessagePart[]; content: string }): string {
  if (!message.parts?.length) {
    return message.content;
  }

  return extractPlainTextFromParts(message.parts);
}

export function formatMessageTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${day} ${time}`;
}

export function hydrateChatMessage(input: {
  message: PersistedConversationMessage;
  assistantModelLabel?: string;
}): ChatMessage {
  return {
    content:
      input.message.role === "assistant"
        ? input.message.content
        : getUserMessageText({ content: input.message.content, parts: input.message.parts }),
    createdAt: input.message.createdAt,
    id: input.message.id,
    modelLabel: input.message.role === "assistant" ? input.assistantModelLabel : undefined,
    parts: input.message.role === "user" ? input.message.parts : undefined,
    role: input.message.role,
    toolCalls: [],
  };
}

export function releaseAttachmentPreview(attachment: ComposerAttachment) {
  if (attachment.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function buildAttachmentLabel(attachment: { extractionStatus: AttachmentExtractionStatus; kind: AttachmentKind }) {
  if (attachment.kind === "image") {
    return "Imagem";
  }

  switch (attachment.extractionStatus) {
    case "completed":
      return "Documento indexado";
    case "unsupported_scan":
      return "Scan sem OCR";
    case "processing":
      return "Processando";
    default:
      return "Documento sem texto";
  }
}

export async function persistMessagesForConversation(conversationId: string, outgoingMessages: Array<{
  content?: string;
  parts?: ConversationMessagePart[];
  role: "assistant" | "user";
}>) {
  return apiJsonRequest<{ messages: PersistedConversationMessage[] }>(
    `/conversations/${conversationId}/messages`,
    "POST",
    { messages: outgoingMessages },
  );
}

export async function trimConversation(conversationId: string, input: {
  afterMessageId?: string;
  fromMessageId?: string;
}) {
  const query = new URLSearchParams();
  if (input.afterMessageId) {
    query.set("afterMessageId", input.afterMessageId);
  }
  if (input.fromMessageId) {
    query.set("fromMessageId", input.fromMessageId);
  }

  return apiJson<{ deletedMessageIds: string[] }>(`/conversations/${conversationId}/messages?${query.toString()}`, {
    method: "DELETE",
  });
}

export function resolveModelSelectPlaceholder(input: {
  hasModels: boolean;
  providerReady: boolean;
}): string {
  if (!input.hasModels) return "Sem modelo";
  if (input.providerReady) return "Modelo";
  return "Credenciais…";
}
