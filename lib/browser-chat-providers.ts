"use client";

import { apiJson } from "@/lib/api";
import { extractPlainTextFromParts, type ConversationMessagePart } from "@/lib/chat-parts";
import { PUTER_PROVIDER_ID } from "@/lib/puter-models";
import {
  isPuterSignedIn,
  signInToPuter,
  streamPuterChat,
  type PuterChatMessage,
} from "@/lib/puter-client";

export type BrowserProviderAuthState = "loading" | "signed-in" | "signed-out" | "unknown";

type BrowserChatConversationMessage = {
  parts: readonly ConversationMessagePart[];
  role: "assistant" | "user";
};

type BrowserChatProviderAdapter = {
  attachments: {
    documents: boolean;
    images: boolean;
  };
  auth: {
    getState: () => Promise<Exclude<BrowserProviderAuthState, "loading" | "unknown">>;
    signIn: () => Promise<void>;
  };
  providerId: string;
  stream: (input: {
    conversationMessages: readonly BrowserChatConversationMessage[];
    modelId: string;
    onTextDelta: (delta: string) => void;
    projectId?: string;
    signal: AbortSignal;
  }) => Promise<string>;
  titleGeneration: "server" | "unsupported";
};

type UserSettingsPayload = {
  settings: {
    customInstructionsAbout: string | null;
    customInstructionsStyle: string | null;
  };
};

type UserMemoriesPayload = {
  memories: Array<{ content: string }>;
};

type ProjectContextPayload = {
  instructions: string | null;
  knowledge: Array<{ fileName: string; text: string }>;
};

/** Caps idênticos ao GET /projects/:id/context (defesa extra além do servidor). */
const PROJECT_INSTRUCTIONS_CHAR_CAP = 20_000;
const PROJECT_KNOWLEDGE_PER_FILE_CHAR_CAP = 20_000;
const PROJECT_KNOWLEDGE_TOTAL_CHAR_CAP = 60_000;

const DEFAULT_BROWSER_SYSTEM_PROMPT = [
  "Format all responses using proper Markdown.",
  "For code, ALWAYS use fenced code blocks with the language identifier.",
  "Never collapse multiple lines of code onto a single line.",
  "Separate code blocks from surrounding text with blank lines.",
].join(" ");

export function formatProjectContext(payload: ProjectContextPayload): string | null {
  const sectionParts: string[] = [];
  const instructions = payload.instructions?.slice(0, PROJECT_INSTRUCTIONS_CHAR_CAP);
  if (instructions) {
    sectionParts.push(`Project instructions:\n${instructions}`);
  }

  let remaining = PROJECT_KNOWLEDGE_TOTAL_CHAR_CAP;
  const knowledgeBlocks: string[] = [];
  for (const file of payload.knowledge) {
    if (remaining <= 0) break;
    const text = file.text.slice(0, Math.min(PROJECT_KNOWLEDGE_PER_FILE_CHAR_CAP, remaining));
    if (!text) continue;
    knowledgeBlocks.push(`[${file.fileName}]\n${text}`);
    remaining -= text.length;
  }
  if (knowledgeBlocks.length > 0) {
    sectionParts.push(`Project knowledge:\n${knowledgeBlocks.join("\n\n")}`);
  }

  return sectionParts.length > 0 ? sectionParts.join("\n\n") : null;
}

export async function buildBrowserSystemPrompt(projectId?: string): Promise<string> {
  const tasks: Array<Promise<unknown>> = [
    apiJson<UserSettingsPayload>("/user/settings"),
    apiJson<UserMemoriesPayload>("/user/memories"),
  ];
  if (projectId) {
    tasks.push(apiJson<ProjectContextPayload>(`/projects/${projectId}/context`));
  }

  const results = await Promise.allSettled(tasks);

  const systemParts: string[] = [DEFAULT_BROWSER_SYSTEM_PROMPT];
  const [settingsResult, memoriesResult, projectResult] = results as [
    PromiseSettledResult<UserSettingsPayload>,
    PromiseSettledResult<UserMemoriesPayload>,
    PromiseSettledResult<ProjectContextPayload> | undefined,
  ];

  if (settingsResult.status === "fulfilled") {
    const { customInstructionsAbout, customInstructionsStyle } = settingsResult.value.settings;
    if (customInstructionsAbout) {
      systemParts.push(`About the user: ${customInstructionsAbout}`);
    }
    if (customInstructionsStyle) {
      systemParts.push(`Response style: ${customInstructionsStyle}`);
    }
  }

  if (memoriesResult.status === "fulfilled" && memoriesResult.value.memories.length > 0) {
    systemParts.push(
      `User memories:\n${memoriesResult.value.memories
        .slice(0, 50)
        .map((memory) => `- ${memory.content}`)
        .join("\n")}`,
    );
  }

  // Falha na busca do contexto de projeto não deve impedir o chat no navegador.
  if (projectResult?.status === "fulfilled") {
    const projectContext = formatProjectContext(projectResult.value);
    if (projectContext) {
      systemParts.push(projectContext);
    }
  }

  return systemParts.join("\n\n");
}

async function buildPuterMessages(
  conversationMessages: readonly BrowserChatConversationMessage[],
  projectId?: string,
): Promise<PuterChatMessage[]> {
  const messages: PuterChatMessage[] = [
    { role: "system", content: await buildBrowserSystemPrompt(projectId) },
  ];

  for (const message of conversationMessages) {
    const content = extractPlainTextFromParts(message.parts).trim();
    if (!content) {
      continue;
    }
    messages.push({ role: message.role, content });
  }

  return messages;
}

const puterAdapter: BrowserChatProviderAdapter = {
  attachments: { documents: false, images: false },
  auth: {
    async getState() {
      return (await isPuterSignedIn()) ? "signed-in" : "signed-out";
    },
    signIn: signInToPuter,
  },
  providerId: PUTER_PROVIDER_ID,
  async stream(input) {
    const messages = await buildPuterMessages(input.conversationMessages, input.projectId);
    return streamPuterChat({
      messages,
      modelId: input.modelId,
      onTextDelta: input.onTextDelta,
      signal: input.signal,
    });
  },
  titleGeneration: "unsupported",
};

const browserChatProviders: Record<string, BrowserChatProviderAdapter> = {
  [PUTER_PROVIDER_ID]: puterAdapter,
};

export function getBrowserChatProviderAdapter(
  providerId: string | null | undefined,
): BrowserChatProviderAdapter | null {
  if (!providerId) {
    return null;
  }

  return browserChatProviders[providerId] ?? null;
}
