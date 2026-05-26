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

const DEFAULT_BROWSER_SYSTEM_PROMPT = [
  "Format all responses using proper Markdown.",
  "For code, ALWAYS use fenced code blocks with the language identifier.",
  "Never collapse multiple lines of code onto a single line.",
  "Separate code blocks from surrounding text with blank lines.",
].join(" ");

async function buildBrowserSystemPrompt(): Promise<string> {
  const [settingsResult, memoriesResult] = await Promise.allSettled([
    apiJson<UserSettingsPayload>("/user/settings"),
    apiJson<UserMemoriesPayload>("/user/memories"),
  ]);

  const systemParts: string[] = [DEFAULT_BROWSER_SYSTEM_PROMPT];
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

  return systemParts.join("\n\n");
}

async function buildPuterMessages(
  conversationMessages: readonly BrowserChatConversationMessage[],
): Promise<PuterChatMessage[]> {
  const messages: PuterChatMessage[] = [
    { role: "system", content: await buildBrowserSystemPrompt() },
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
    const messages = await buildPuterMessages(input.conversationMessages);
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
