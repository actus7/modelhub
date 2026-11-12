/**
 * Mensagens de chat do gateway: schema de entrada, normalização para o formato
 * interno e resolução de anexos e contexto (projeto, instruções, memórias)
 * antes do envio ao provedor.
 */

import { z } from "zod";

import type { ProviderModelCapabilities } from "@/lib/chat-parts";

import { MAX_DOCUMENT_CONTEXT_CHARS, buildDocumentContextBlock } from "./conversation-attachments";
import { prisma } from "./db";
import { fetchCachedProviderModels, type ProviderConfig } from "./provider-config";

type ChatMessageToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ChatMessageContentPart[];
  tool_calls?: ChatMessageToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ChatMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

type ChatInputAttachmentPart = {
  attachmentId: string;
  fileName: string;
  kind: "document" | "image";
  mimeType: string;
  type: "attachment";
};

type ChatInputContentPart = ChatMessageContentPart | ChatInputAttachmentPart;

type ChatInputMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ChatInputContentPart[];
  tool_calls?: ChatMessageToolCall[];
  tool_call_id?: string;
  name?: string;
};

type RawMessagePart = {
  attachmentId?: string;
  fileName?: string;
  kind?: string;
  mimeType?: string;
  type?: string;
  text?: string;
  image_url?: { url?: string; detail?: string };
};

/** Entrada bruta OpenAI-compatible: tool_calls podem vir sem id ou com arguments como objeto. */
type RawIncomingToolCall = {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown> | unknown[];
  };
};

type RawChatMessage = {
  /** Qualquer string compatível com OpenAI/Claude; normalizamos em normalizeMessages. */
  role?: string;
  content?: string | RawMessagePart[] | null;
  parts?: RawMessagePart[];
  tool_calls?: RawIncomingToolCall[];
  tool_call_id?: string;
  name?: string;
};

type UserSettingsRecord = {
  customInstructionsAbout: string | null;
  customInstructionsStyle: string | null;
};

type UserMemoryRecord = {
  content: string;
};

/** Agentes podem enviar histórico longo com várias tool rounds — 50 era pouco. */
const MAX_MESSAGES = 256;
const MAX_PARTS_PER_MESSAGE = 64;
/**
 * Agent runtimes can prepend a very large system prompt containing the active
 * tool inventory and safety/runtime instructions. Keep this comfortably above
 * that prompt size while still bounded below the total request-body cap.
 */
const MAX_MESSAGE_TEXT_LENGTH = 256_000;
export const MAX_PROVIDER_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_URL_LENGTH = 4 * 1024 * 1024;

/** Caps de injeção de contexto de projeto — mesmos valores do GET /projects/:id/context. */
const PROJECT_INSTRUCTIONS_CHAR_CAP = 20_000;
const PROJECT_KNOWLEDGE_PER_FILE_CHAR_CAP = 20_000;
const PROJECT_KNOWLEDGE_TOTAL_CHAR_CAP = 60_000;

const rawMessagePartSchema = z
  .object({
    attachmentId: z.string().max(256).optional(),
    fileName: z.string().max(512).optional(),
    kind: z.string().max(64).optional(),
    mimeType: z.string().max(256).optional(),
    type: z.string().max(64).optional(),
    text: z
      .union([z.string().max(MAX_MESSAGE_TEXT_LENGTH), z.null()])
      .optional()
      .transform((v) => (v === null ? undefined : v)),
    image_url: z
      .object({
        url: z
          .union([z.string().max(MAX_PROVIDER_IMAGE_URL_LENGTH), z.null()])
          .optional()
          .transform((v) => (v === null ? undefined : v)),
        detail: z
          .union([z.string().max(32), z.null()])
          .optional()
          .transform((v) => (v === null ? undefined : v)),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Clientes OpenAI-compatible podem enviar arguments como string JSON ou objeto. */
const toolCallFunctionSchema = z.object({
  name: z.string().max(256),
  arguments: z
    .union([
      z.string().max(MAX_MESSAGE_TEXT_LENGTH),
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
    ])
    .transform((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .pipe(z.string().max(MAX_MESSAGE_TEXT_LENGTH * 2)),
});

const toolCallSchema = z
  .object({
    id: z.string().max(256).optional(),
    /** Alguns clientes omitem; assumimos function. */
    type: z.literal("function").optional(),
    function: toolCallFunctionSchema,
  })
  .passthrough();

const rawChatMessageSchema = z
  .object({
    role: z.string().max(64).optional(),
    content: z
      .union([
        z.string().max(MAX_MESSAGE_TEXT_LENGTH),
        z.array(rawMessagePartSchema).max(MAX_PARTS_PER_MESSAGE),
        z.null(),
      ])
      .optional(),
    parts: z.array(rawMessagePartSchema).max(MAX_PARTS_PER_MESSAGE).optional(),
    tool_calls: z.array(toolCallSchema).max(64).optional(),
    tool_call_id: z.string().max(256).optional(),
    name: z.string().max(256).optional(),
  })
  .passthrough();

export const providerChatBodySchema = z
  .object({
    modelId: z.string().trim().min(1).max(200).optional(),
    messages: z.array(rawChatMessageSchema).min(1).max(MAX_MESSAGES),
  })
  .passthrough();

function normalizeContentParts(parts: RawMessagePart[]): ChatInputContentPart[] {
  const out: ChatInputContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      out.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      out.push({
        type: "image_url",
        image_url: { url: part.image_url.url, detail: part.image_url.detail },
      });
    } else if (
      part.type === "attachment" &&
      typeof part.attachmentId === "string" &&
      (part.kind === "image" || part.kind === "document") &&
      typeof part.fileName === "string" &&
      typeof part.mimeType === "string"
    ) {
      out.push({
        attachmentId: part.attachmentId,
        fileName: part.fileName,
        kind: part.kind,
        mimeType: part.mimeType,
        type: "attachment",
      });
    }
  }
  return out;
}

const ROLE_ALIASES: Record<string, ChatInputMessage["role"]> = {
  assistant: "assistant",
  developer: "system",
  function: "tool",
  system: "system",
  tool: "tool",
};

function mapRole(raw: string | undefined): ChatInputMessage["role"] {
  if (!raw) return "user";
  return ROLE_ALIASES[raw] ?? "user";
}

function normalizeContent(item: RawChatMessage): string | ChatInputContentPart[] {
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    const parts = normalizeContentParts(item.content);
    if (parts.length > 0) return parts;
  }

  if (Array.isArray(item.parts)) {
    const parts = normalizeContentParts(item.parts);
    if (parts.length > 0) return parts;
  }

  return "";
}

function normalizeToolCalls(
  toolCalls: RawChatMessage["tool_calls"],
): ChatMessageToolCall[] | undefined {
  if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

  return toolCalls.map((tc, i) => {
    const id = typeof tc.id === "string" && tc.id.length > 0 ? tc.id : `tool_${i}`;
    const name = typeof tc.function?.name === "string" ? tc.function.name : "";
    const args = tc.function?.arguments;
    let argumentsStr = "{}";
    if (typeof args === "string") argumentsStr = args;
    else if (args !== undefined) argumentsStr = JSON.stringify(args);
    return {
      id,
      type: "function" as const,
      function: { name, arguments: argumentsStr },
    };
  });
}

export function normalizeMessages(input: RawChatMessage[]): ChatInputMessage[] {
  if (!Array.isArray(input)) return [];

  return input.map((item) => {
    const msg: ChatInputMessage = {
      role: mapRole(item.role),
      content: normalizeContent(item),
    };

    const toolCalls = normalizeToolCalls(item.tool_calls);
    if (toolCalls) msg.tool_calls = toolCalls;
    if (typeof item.tool_call_id === "string" && item.tool_call_id)
      msg.tool_call_id = item.tool_call_id;
    if (typeof item.name === "string" && item.name) msg.name = item.name;

    return msg;
  });
}

export class AttachmentCapabilityError extends Error {
  status = 400;
}

function toDataUrl(mimeType: string, blob: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(blob).toString("base64")}`;
}

export async function getModelCapabilities(
  config: ProviderConfig,
  modelId: string,
  credentials: Record<string, string>,
  userId: string | undefined,
): Promise<ProviderModelCapabilities> {
  const staticMatch = config.models.find((model) => model.id === modelId);
  if (staticMatch) {
    return staticMatch.capabilities;
  }

  if (config.fetchModels) {
    const fetchedModels = await fetchCachedProviderModels(config, credentials, userId);
    const dynamicMatch = fetchedModels.find((model) => model.id === modelId);
    if (dynamicMatch) {
      return dynamicMatch.capabilities;
    }
  }

  return { documents: true, images: false };
}

export function requestUsesTools(rawBody: Record<string, unknown>): boolean {
  const tools = rawBody.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    return true;
  }

  const toolChoice = rawBody.tool_choice;
  return Boolean(
    toolChoice &&
    toolChoice !== "none" &&
    (typeof toolChoice === "object" || toolChoice === "required"),
  );
}

type ResolvedAttachment = {
  blob: Uint8Array;
  extractedText: string | null;
  extractionStatus: "completed" | "failed" | "processing" | "unsupported_scan";
  fileName: string;
  id: string;
  kind: "document" | "image";
  mimeType: string;
};

function collectAttachmentIds(messages: ChatInputMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "attachment") ids.add(part.attachmentId);
    }
  }
  return ids;
}

async function loadAttachments(
  attachmentIds: Set<string>,
  userId: string | undefined,
): Promise<Map<string, ResolvedAttachment>> {
  if (attachmentIds.size === 0) return new Map();
  if (!userId)
    throw new AttachmentCapabilityError("Authenticated user context is required for attachments");

  const rows = await prisma.conversationAttachment.findMany({
    where: { conversation: { userId }, id: { in: [...attachmentIds] } },
    select: {
      blob: true,
      extractedText: true,
      extractionStatus: true,
      fileName: true,
      id: true,
      kind: true,
      mimeType: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        blob: row.blob,
        extractedText: row.extractedText,
        extractionStatus: row.extractionStatus as ResolvedAttachment["extractionStatus"],
        fileName: row.fileName,
        id: row.id,
        kind: row.kind as ResolvedAttachment["kind"],
        mimeType: row.mimeType,
      },
    ]),
  );
}

/**
 * Busca o contexto de projeto (instruções + knowledge) apenas quando o projeto
 * pertence ao usuário autenticado (`userId` no where). Projeto inválido ou de
 * outro usuário → retorna null silenciosamente (sem vazar informação).
 */
async function buildProjectContextSection(
  projectId: string,
  userId: string,
): Promise<string | null> {
  const findProject = prisma.project?.findFirst?.bind?.(prisma.project);
  if (!findProject) return null;

  const project = await findProject({ where: { id: projectId, userId } });
  if (!project) return null;

  const sectionParts: string[] = [];
  const instructions = project.instructions?.slice(0, PROJECT_INSTRUCTIONS_CHAR_CAP);
  if (instructions) {
    sectionParts.push(`Project instructions:\n${instructions}`);
  }

  const findProjectFiles = prisma.projectFile?.findMany?.bind?.(prisma.projectFile);
  if (findProjectFiles) {
    const files = await findProjectFiles({
      where: { projectId: project.id, extractedText: { not: null } },
      select: { extractedText: true, fileName: true },
      orderBy: { createdAt: "asc" },
    });

    let remaining = PROJECT_KNOWLEDGE_TOTAL_CHAR_CAP;
    const knowledgeBlocks: string[] = [];
    for (const file of files) {
      if (remaining <= 0) break;
      const text = (file.extractedText ?? "").slice(
        0,
        Math.min(PROJECT_KNOWLEDGE_PER_FILE_CHAR_CAP, remaining),
      );
      if (!text) continue;
      knowledgeBlocks.push(`[${file.fileName}]\n${text}`);
      remaining -= text.length;
    }
    if (knowledgeBlocks.length > 0) {
      sectionParts.push(`Project knowledge:\n${knowledgeBlocks.join("\n\n")}`);
    }
  }

  if (sectionParts.length === 0) return null;
  return sectionParts.join("\n\n");
}

async function buildUserContextMessage(
  userId: string,
  projectId?: string,
): Promise<ChatMessage | null> {
  const findUserSettings = prisma.userSettings?.findUnique?.bind?.(prisma.userSettings);
  const findUserMemories = prisma.userMemory?.findMany?.bind?.(prisma.userMemory);
  const projectContextPromise = projectId
    ? buildProjectContextSection(projectId, userId)
    : Promise.resolve<string | null>(null);

  const [userSettings, userMemories, projectContext] = await Promise.all([
    findUserSettings
      ? findUserSettings({ where: { userId } })
      : Promise.resolve<UserSettingsRecord | null>(null),
    findUserMemories
      ? findUserMemories({
          where: { userId },
          select: { content: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve<UserMemoryRecord[]>([]),
    projectContextPromise,
  ]);

  const systemParts: string[] = [];
  if (userSettings?.customInstructionsAbout) {
    systemParts.push(`About the user: ${userSettings.customInstructionsAbout}`);
  }
  if (userSettings?.customInstructionsStyle) {
    systemParts.push(`Response style: ${userSettings.customInstructionsStyle}`);
  }
  if (userMemories.length > 0) {
    systemParts.push(`User memories:\n${userMemories.map((m) => `- ${m.content}`).join("\n")}`);
  }
  if (projectContext) {
    systemParts.push(projectContext);
  }

  if (systemParts.length === 0) return null;
  return { role: "system", content: systemParts.join("\n\n") };
}

function resolveAttachmentPart(
  part: ChatInputContentPart & { type: "attachment" },
  attachmentsById: Map<string, ResolvedAttachment>,
  modelCapabilities: ProviderModelCapabilities,
  modelId: string,
  remainingDocumentChars: number,
): { contentPart: ChatMessageContentPart | null; consumedChars: number } {
  const attachment = attachmentsById.get(part.attachmentId);
  if (!attachment)
    throw new AttachmentCapabilityError(`Attachment "${part.fileName}" was not found`);

  if (attachment.kind === "image") {
    if (!modelCapabilities.images) {
      throw new AttachmentCapabilityError(`Modelo "${modelId}" nao suporta anexos de imagem`);
    }
    return {
      contentPart: {
        type: "image_url",
        image_url: { url: toDataUrl(attachment.mimeType, attachment.blob) },
      },
      consumedChars: 0,
    };
  }

  const block = buildDocumentContextBlock({
    extractedText: attachment.extractedText,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    remainingChars: remainingDocumentChars,
    status: attachment.extractionStatus,
  });
  return {
    contentPart: block.text ? { type: "text", text: block.text } : null,
    consumedChars: block.consumedChars,
  };
}

function resolveMessageContent(
  message: ChatInputMessage,
  attachmentsById: Map<string, ResolvedAttachment>,
  modelCapabilities: ProviderModelCapabilities,
  modelId: string,
): ChatMessage {
  if (typeof message.content === "string") {
    return { ...message, content: message.content };
  }

  let remainingDocumentChars = MAX_DOCUMENT_CONTEXT_CHARS;
  const contentParts: ChatMessageContentPart[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "image_url") {
      contentParts.push(part);
      continue;
    }

    const { contentPart, consumedChars } = resolveAttachmentPart(
      part,
      attachmentsById,
      modelCapabilities,
      modelId,
      remainingDocumentChars,
    );
    if (contentPart) contentParts.push(contentPart);
    remainingDocumentChars = Math.max(0, remainingDocumentChars - consumedChars);
  }

  return { ...message, content: contentParts.length > 0 ? contentParts : "" };
}

export async function resolveMessagesForProvider(input: {
  config: ProviderConfig;
  credentials: Record<string, string>;
  messages: ChatInputMessage[];
  modelId: string;
  modelCapabilities?: ProviderModelCapabilities;
  userId?: string;
  projectId?: string;
}): Promise<ChatMessage[]> {
  const modelCapabilities =
    input.modelCapabilities ??
    (await getModelCapabilities(input.config, input.modelId, input.credentials, input.userId));

  const attachmentIds = collectAttachmentIds(input.messages);
  const attachmentsById = await loadAttachments(attachmentIds, input.userId);

  const resolvedMessages: ChatMessage[] = [];
  if (input.userId) {
    const ctx = await buildUserContextMessage(input.userId, input.projectId);
    if (ctx) resolvedMessages.push(ctx);
  }

  for (const message of input.messages) {
    resolvedMessages.push(
      resolveMessageContent(message, attachmentsById, modelCapabilities, input.modelId),
    );
  }

  return resolvedMessages;
}
