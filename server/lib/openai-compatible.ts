import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  toVercelToolCallsResponse,
  upstreamErrorResponse,
} from "./provider-core";
import type { ChatMessage, ProviderModel } from "./provider-core";
import {
  getCooldownRemainingMs,
  rateLimitCooldownKey,
  recordRateLimit,
  recordUpstreamFailure,
} from "./rate-limit-cooldown";
import { scrubSecrets } from "./secret-scrub";

/**
 * Padrão único de provedor: API OpenAI-compatível em `baseUrl`
 * (`POST /chat/completions`, `GET /models`) autenticada por API key Bearer.
 * Provedor que não funciona assim não entra no ModelHub.
 */
export type OpenAiCompatibleProvider = {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  keyPlaceholder?: string;
  signupUrl?: string;
  models: ProviderModel[];
};

const CHAT_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 15_000;

/** Campos OpenAI repassados do corpo original quando presentes. */
const PASSTHROUGH_FIELDS = [
  "tools",
  "tool_choice",
  "response_format",
  "temperature",
  "max_tokens",
  "max_completion_tokens",
  "top_p",
  "stop",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "n",
  "logprobs",
  "top_logprobs",
  "user",
  "reasoning_effort",
] as const;

/** Modelos que não são de chat (listados por `/models` de vários provedores). */
const NON_CHAT_MODEL_RE =
  /(^|[/:_-])(embed|embedding|rerank|moderation|whisper|tts|dall-e|image|audio|transcribe|guard)([/:_-]|$)/i;

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiNonStreamingResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
} | null;

function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = { role: msg.role, content: msg.content };
    if (msg.tool_calls && msg.tool_calls.length > 0) out.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
    if (msg.name) out.name = msg.name;
    return out;
  });
}

function buildOpenAiCompatibleChatBody(input: {
  messages: ChatMessage[];
  modelId: string;
  rawBody: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.modelId,
    messages: toOpenAiMessages(input.messages),
    stream: true,
    stream_options: { include_usage: true },
  };

  for (const field of PASSTHROUGH_FIELDS) {
    if (input.rawBody[field] !== undefined) {
      body[field] = input.rawBody[field];
    }
  }

  return body;
}

async function responseFromSuccessfulUpstream(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return toVercelStreamFromOpenAiSse(response);
  }

  const json = (await response.json().catch(() => null)) as OpenAiNonStreamingResponse;
  const message = json?.choices?.[0]?.message;

  if (message?.tool_calls && message.tool_calls.length > 0) {
    return toVercelToolCallsResponse(message.tool_calls, message.content || undefined);
  }

  return toVercelSingleTextResponse(String(message?.content ?? ""));
}

function authHeaders(
  apiKeyEnv: string,
  credentials?: Record<string, string>,
): Record<string, string> {
  return { Authorization: `Bearer ${resolveEnv(apiKeyEnv, credentials)}` };
}

export async function chatViaOpenAiCompatible(
  provider: Pick<OpenAiCompatibleProvider, "label" | "baseUrl" | "apiKeyEnv">,
  input: {
    messages: ChatMessage[];
    modelId: string;
    rawBody: Record<string, unknown>;
  },
  credentials?: Record<string, string>,
): Promise<Response> {
  const headers = authHeaders(provider.apiKeyEnv, credentials);
  const cooldownKey = rateLimitCooldownKey(provider.label, input.modelId);

  try {
    const cooldownRemainingMs = getCooldownRemainingMs(cooldownKey);
    if (cooldownRemainingMs > 0) {
      return upstreamErrorResponse(
        provider.label,
        429,
        `Rate limit em cooldown; tente novamente em ~${Math.ceil(cooldownRemainingMs / 1000)}s.`,
      );
    }

    const response = await postJsonWithTimeout(`${provider.baseUrl}/chat/completions`, {
      headers,
      body: buildOpenAiCompatibleChatBody(input),
      timeoutMs: CHAT_TIMEOUT_MS,
    });

    if (response.ok) {
      return responseFromSuccessfulUpstream(response);
    }

    if (response.status === 429) {
      recordRateLimit(cooldownKey, response.headers.get("retry-after"));
    } else if (response.status >= 500) {
      recordUpstreamFailure(cooldownKey);
    }

    const errorText = scrubSecrets(await response.text());
    return upstreamErrorResponse(provider.label, response.status, errorText, {
      requestedModel: input.modelId,
    });
  } catch (error) {
    return internalProviderErrorResponse(provider.label, error);
  }
}

/** Valida a chave via `GET /models` (não gasta tokens). */
export async function testViaOpenAiModels(
  provider: Pick<OpenAiCompatibleProvider, "baseUrl" | "apiKeyEnv">,
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/models`,
      { method: "GET", headers: authHeaders(provider.apiKeyEnv, credentials) },
      MODELS_TIMEOUT_MS,
    );
    if (response.ok) return { ok: true };

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Chave inválida ou sem permissão (${response.status}).` };
    }
    // Provedores podem ecoar a credencial no corpo do erro — redige antes de devolver ao navegador.
    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      error: `Erro ${response.status}: ${scrubSecrets(errorText).slice(0, 200)}`,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CONFIG_ERROR:")) {
      return { ok: false, error: "Credencial não fornecida." };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido." };
  }
}

function hasImageCapability(model: Record<string, unknown>): boolean {
  const architecture = model.architecture as Record<string, unknown> | undefined;
  const candidates = [model.input_modalities, model.modalities, architecture?.input_modalities];
  return candidates.some(
    (candidate) =>
      Array.isArray(candidate) &&
      candidate.some((value) => typeof value === "string" && value.toLowerCase() === "image"),
  );
}

function hasToolCapability(model: Record<string, unknown>): boolean {
  const supportedParameters = model.supported_parameters;
  if (!Array.isArray(supportedParameters)) return true;
  return supportedParameters.some((value) => value === "tools" || value === "tool_choice");
}

function readModelOutputLimit(model: Record<string, unknown>): number | undefined {
  for (const key of ["max_output_tokens", "max_completion_tokens", "max_tokens"]) {
    const value = model[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_MODEL_RE.test(id);
}

/** Lista modelos de chat via `GET /models`. */
export function createOpenAiFetchModels(
  provider: Pick<OpenAiCompatibleProvider, "label" | "baseUrl" | "apiKeyEnv">,
): (credentials?: Record<string, string>) => Promise<ProviderModel[]> {
  return async (credentials) => {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/models`,
      { method: "GET", headers: authHeaders(provider.apiKeyEnv, credentials) },
      MODELS_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`${provider.label} models API returned ${response.status}`);
    }

    const json = (await response.json()) as {
      data?: Array<Record<string, unknown> & { id: string }>;
    };
    if (!json.data?.length) {
      throw new Error(`Empty models response from ${provider.label}`);
    }

    const seen = new Set<string>();
    const models: ProviderModel[] = [];
    for (const raw of json.data) {
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!id || seen.has(id) || !isChatModelId(id)) continue;
      seen.add(id);
      const maxOutputTokens = readModelOutputLimit(raw);
      models.push({
        capabilities: {
          documents: true,
          images: hasImageCapability(raw),
          tools: hasToolCapability(raw),
        },
        id,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        name: id,
      });
    }
    return models;
  };
}

/** Monta o app Hono de um provedor a partir da definição declarativa. */
export function createOpenAiCompatibleProvider(provider: OpenAiCompatibleProvider) {
  const fetchModels = createOpenAiFetchModels(provider);
  const app = createProviderApp({
    providerId: provider.id,
    basePath: `/${provider.id}`,
    models: provider.models,
    defaultModel: provider.models[0]?.id ?? "",
    chat: (messages, modelId, rawBody, credentials) =>
      chatViaOpenAiCompatible(provider, { messages, modelId, rawBody }, credentials),
    fetchModels,
    testCredentials: (credentials) => testViaOpenAiModels(provider, credentials),
  });
  return { handler: app.fetch, fetchModels };
}
