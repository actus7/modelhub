import {
  MODELHUB_EFFECTIVE_MODEL_HEADER,
  MODELHUB_FALLBACK_DIAGNOSTIC_HEADER,
  MODELHUB_MODEL_FALLBACK_USED_HEADER,
  MODELHUB_MODELS_ATTEMPTED_HEADER,
  MODELHUB_REQUESTED_MODEL_HEADER,
} from '@/lib/contracts'
import {
  fetchWithTimeout,
  internalProviderErrorResponse,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  toVercelToolCallsResponse,
  upstreamErrorResponse,
} from './provider-core'
import type { ChatMessage, ProviderModel } from './provider-core'

function hasImageCapability(model: Record<string, unknown>): boolean {
  const candidates = [
    model.input_modalities,
    model.modalities,
    typeof model.architecture === 'object' && model.architecture !== null
      ? (model.architecture as Record<string, unknown>).input_modalities
      : undefined,
    typeof model.capabilities === 'object' && model.capabilities !== null
      ? (model.capabilities as Record<string, unknown>).input_modalities
      : undefined,
  ]

  return candidates.some((candidate) =>
    Array.isArray(candidate) &&
    candidate.some((value) => typeof value === 'string' && value.toLowerCase() === 'image'),
  )
}

function hasToolCapability(model: Record<string, unknown>): boolean {
  const supportedParameters = model.supported_parameters
  if (Array.isArray(supportedParameters)) {
    return supportedParameters.some(
      (value) =>
        typeof value === 'string' &&
        (value.toLowerCase() === 'tools' || value.toLowerCase() === 'tool_choice'),
    )
  }

  const capabilities =
    typeof model.capabilities === 'object' && model.capabilities !== null
      ? (model.capabilities as Record<string, unknown>)
      : undefined
  if (typeof capabilities?.tools === 'boolean') {
    return capabilities.tools
  }

  return true
}

type OpenAiCompatibleConfig = {
  providerName: string
  chatUrl: string
  apiKeyEnv: string
  extraHeaders?: Record<string, string>
  bodyTransform?: (input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> }) => Record<string, unknown>
  timeoutMs?: number
  /**
   * When upstream returns 404 for an unknown / inaccessible model, retry with these IDs in order
   * (after the user-selected model). Skips duplicates. Used e.g. when catalog ≠ entitlement (Cerebras).
   */
  fallbackModelIds?: string[]
}

/**
 * Default system prompt injected when the conversation has no system message.
 * Instructs models to use proper markdown formatting — especially fenced code
 * blocks — so the client-side renderer can display responses correctly.
 */
const DEFAULT_SYSTEM_PROMPT = [
  'Format all responses using proper Markdown.',
  'For code, ALWAYS use fenced code blocks with the language identifier (e.g. ```python).',
  'Never collapse multiple lines of code onto a single line.',
  'Separate code blocks from surrounding text with blank lines.',
].join(' ')

/** OpenAI-compatible fields that should be forwarded when present in rawBody. */
const PASSTHROUGH_FIELDS = [
  'tools',
  'tool_choice',
  'response_format',
  'temperature',
  'max_tokens',
  'top_p',
  'stop',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'n',
  'logprobs',
  'top_logprobs',
  'user',
  'reasoning_effort',
] as const

/** Convert ChatMessage[] to OpenAI-compatible message format. */
function toOpenAiMessages(
  messages: ChatMessage[],
): Record<string, unknown>[] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = { role: msg.role }

    if (typeof msg.content === 'string') {
      out.content = msg.content
    } else if (Array.isArray(msg.content)) {
      out.content = msg.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text }
        if (part.type === 'image_url') return { type: 'image_url', image_url: part.image_url }
        return part
      })
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) out.tool_calls = msg.tool_calls
    if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id
    if (msg.name) out.name = msg.name

    return out
  })
}

function buildDefaultBody(
  input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> },
): Record<string, unknown> {
  const openAiMessages = toOpenAiMessages(input.messages)

  // Inject a system prompt if the conversation doesn't already have one,
  // so that models produce well-formatted markdown (especially code blocks).
  const hasSystemMessage = openAiMessages.some((m) => m.role === 'system')
  if (!hasSystemMessage) {
    openAiMessages.unshift({ role: 'system', content: DEFAULT_SYSTEM_PROMPT })
  }

  const body: Record<string, unknown> = {
    model: input.modelId,
    messages: openAiMessages,
    stream: true,
    stream_options: { include_usage: true },
  }

  for (const field of PASSTHROUGH_FIELDS) {
    if (input.rawBody[field] !== undefined) {
      body[field] = input.rawBody[field]
    }
  }

  return body
}

export { buildDefaultBody as buildOpenAiCompatibleChatBody }

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiNonStreamingResponse = {
  choices?: Array<{
    message?: {
      content?: string
      tool_calls?: OpenAiToolCall[]
    }
  }>
  output_text?: string
  response?: string
} | null

function isUpstreamModelNotFound(status: number, errorText: string): boolean {
  if (status !== 404) {
    return false
  }
  return (
    errorText.includes('model_not_found') ||
    errorText.includes('"code":"model_not_found"') ||
    errorText.includes('does not exist or you do not have access') ||
    errorText.includes('Not found for account') ||
    (errorText.includes('Function ') && errorText.includes('Not found'))
  )
}

function dedupeProviderModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>()
  const out: ProviderModel[] = []
  for (const model of models) {
    const id = model.id.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    out.push({ ...model, id })
  }
  return out
}

async function responseFromSuccessfulUpstream(
  response: Response,
): Promise<Response> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) {
    return toVercelStreamFromOpenAiSse(response)
  }

  const json = (await response.json().catch(() => null)) as OpenAiNonStreamingResponse
  const message = json?.choices?.[0]?.message

  if (message?.tool_calls && message.tool_calls.length > 0) {
    return toVercelToolCallsResponse(message.tool_calls, message.content || undefined)
  }

  const directText = message?.content || json?.output_text || json?.response || ''
  return toVercelSingleTextResponse(String(directText))
}

function encodeFallbackDiagnosticHeader(input: {
  requestedModelId: string
  effectiveModelId: string
  failures: Array<{ modelId: string; status: number; snippet: string }>
}): string {
  let failedAttempts = input.failures.map((f) => ({
    modelId: f.modelId,
    status: f.status,
    upstreamSnippet: f.snippet.slice(0, 600),
  }))
  let payload: {
    type: 'model_fallback'
    note: string
    requestedModelId: string
    effectiveModelId: string
    failedAttempts: typeof failedAttempts
  } = {
    type: 'model_fallback',
    note: 'Resposta HTTP 200 após falha(s) em modelo(s) anterior(es); veja failedAttempts.',
    requestedModelId: input.requestedModelId,
    effectiveModelId: input.effectiveModelId,
    failedAttempts,
  }
  let json = JSON.stringify(payload)
  if (json.length > 4500) {
    failedAttempts = failedAttempts.map((f) => ({
      ...f,
      upstreamSnippet: f.upstreamSnippet.slice(0, 200),
    }))
    payload = { ...payload, failedAttempts }
    json = JSON.stringify(payload)
  }
  while (json.length > 5200 && failedAttempts.some((f) => f.upstreamSnippet.length > 80)) {
    failedAttempts = failedAttempts.map((f) => ({
      ...f,
      upstreamSnippet: f.upstreamSnippet.slice(0, Math.max(80, Math.floor(f.upstreamSnippet.length * 0.5))),
    }))
    payload = { ...payload, failedAttempts }
    json = JSON.stringify(payload)
  }
  return Buffer.from(json, 'utf8').toString('base64url')
}

async function attachModelResolutionHeaders(
  responsePromise: Promise<Response>,
  meta: {
    requestedModelId: string
    effectiveModelId: string
    attemptedModelIds: string[]
    fallbackDiagnostics?: Array<{ modelId: string; status: number; snippet: string }>
    fallbackUsed: boolean
  },
): Promise<Response> {
  const out = await responsePromise
  const headers = new Headers(out.headers)
  headers.set(MODELHUB_EFFECTIVE_MODEL_HEADER, meta.effectiveModelId)
  headers.set(MODELHUB_REQUESTED_MODEL_HEADER, meta.requestedModelId)
  headers.set(MODELHUB_MODELS_ATTEMPTED_HEADER, meta.attemptedModelIds.join(','))
  if (meta.fallbackUsed) {
    headers.set(MODELHUB_MODEL_FALLBACK_USED_HEADER, 'true')
    const failures = meta.fallbackDiagnostics ?? []
    if (failures.length > 0) {
      headers.set(
        MODELHUB_FALLBACK_DIAGNOSTIC_HEADER,
        encodeFallbackDiagnosticHeader({
          requestedModelId: meta.requestedModelId,
          effectiveModelId: meta.effectiveModelId,
          failures,
        }),
      )
    }
  }
  return new Response(out.body, {
    status: out.status,
    statusText: out.statusText,
    headers,
  })
}

export async function chatViaOpenAiCompatible(
  config: OpenAiCompatibleConfig,
  input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> },
  credentials?: Record<string, string>,
): Promise<Response> {
  try {
    const apiKey = resolveEnv(config.apiKeyEnv, credentials)

    const extraFallback =
      config.fallbackModelIds?.filter((id) => id !== input.modelId) ?? []
    const modelChain = [input.modelId, ...extraFallback]
    const attempted: string[] = []
    const fallbackFailures: Array<{ modelId: string; status: number; snippet: string }> = []

    for (let idx = 0; idx < modelChain.length; idx++) {
      const modelId = modelChain[idx]!
      attempted.push(modelId)

      const attemptInput = { ...input, modelId }

      const body = config.bodyTransform
        ? config.bodyTransform(attemptInput)
        : buildDefaultBody(attemptInput)

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      }

      if (config.extraHeaders) {
        Object.assign(headers, config.extraHeaders)
      }

      const response = await postJsonWithTimeout(config.chatUrl, {
        headers,
        body,
        timeoutMs: config.timeoutMs ?? 60000,
      })

      if (response.ok) {
        if (idx > 0) {
          console.warn(
            `[${config.providerName}] fallback succeeded using ${modelId} after model_not_found (requested ${input.modelId}); attempted: ${attempted.join(' → ')}`,
          )
        }
        return attachModelResolutionHeaders(responseFromSuccessfulUpstream(response), {
          requestedModelId: input.modelId,
          effectiveModelId: modelId,
          attemptedModelIds: [...attempted],
          fallbackDiagnostics: fallbackFailures,
          fallbackUsed: idx > 0,
        })
      }

      const errorText = await response.text()

      if (isUpstreamModelNotFound(response.status, errorText) && idx < modelChain.length - 1) {
        fallbackFailures.push({
          modelId,
          status: response.status,
          snippet: errorText.slice(0, 2000),
        })
        console.warn(
          `[${config.providerName}] model_not_found for ${modelId}, retrying with ${modelChain[idx + 1]}`,
        )
        continue
      }

      const guidance = getUpstreamErrorGuidance(config.providerName, response.status, errorText)
      if (guidance) {
        console.error(`[${config.providerName}] upstream error ${response.status}: ${errorText.slice(0, 500)}`)
        return toVercelSingleTextResponse(guidance)
      }
      return upstreamErrorResponse(config.providerName, response.status, errorText, {
        requestedModel: input.modelId,
        attemptedModels: attempted,
        ...(attempted.length > 1
          ? {
              hint:
                'Vários modelos foram tentados em sequência; nenhum completou após o último erro. Veja "upstream" para a mensagem da API.',
            }
          : {}),
      })
    }

    return internalProviderErrorResponse(
      config.providerName,
      new Error('chatViaOpenAiCompatible: no model attempts (unexpected)'),
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
      throw error
    }

    return internalProviderErrorResponse(config.providerName, error)
  }
}

/**
 * Test credentials by hitting the /models endpoint of an OpenAI-compatible provider.
 * Returns { ok: true } if the key is valid, or { ok: false, error } otherwise.
 */
export async function testViaOpenAiModels(
  opts: {
    modelsUrl: string
    apiKeyEnv: string
    providerName: string
    extraHeaders?: Record<string, string>
  },
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKey = resolveEnv(opts.apiKeyEnv, credentials)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    }
    if (opts.extraHeaders) {
      Object.assign(headers, opts.extraHeaders)
    }

    const response = await fetchWithTimeout(
      opts.modelsUrl,
      { method: 'GET', headers },
      15000,
    )

    if (response.ok) {
      return { ok: true }
    }

    const errorText = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Chave inválida ou sem permissão (${response.status}).` }
    }
    return { ok: false, error: `Erro ${response.status}: ${errorText.slice(0, 200)}` }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
      return { ok: false, error: 'Credencial não fornecida.' }
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido.' }
  }
}

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 * Returns a list of ProviderModel objects with id and name.
 * Requires a valid API key to be configured.
 */
export function createOpenAiFetchModels(opts: {
  modelsUrl: string
  apiKeyEnv: string
  providerName: string
  extraHeaders?: Record<string, string>
  /** Optional filter to select which models to include. Defaults to all. */
  filter?: (model: { id: string; owned_by?: string }) => boolean
}): (credentials?: Record<string, string>) => Promise<ProviderModel[]> {
  return async (credentials?: Record<string, string>) => {
    const apiKey = resolveEnv(opts.apiKeyEnv, credentials)

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders)

    const response = await fetchWithTimeout(opts.modelsUrl, { method: 'GET', headers }, 15000)
    if (!response.ok) throw new Error(`${opts.providerName} models API returned ${response.status}`)

    const json = (await response.json()) as {
      data?: Array<Record<string, unknown> & { id: string; owned_by?: string }>
    }

    if (!json.data?.length) throw new Error(`Empty models response from ${opts.providerName}`)

    const filtered = opts.filter ? json.data.filter(opts.filter) : json.data

    return dedupeProviderModels(filtered.map((m) => ({
      capabilities: {
        documents: true,
        images: hasImageCapability(m),
        tools: hasToolCapability(m),
      },
      id: m.id,
      name: `${m.id} (${opts.providerName})`,
    })))
  }
}

/**
 * Return a user-facing guidance message for known upstream errors,
 * or null if the error is not recognized and should use the default handler.
 */
function getUpstreamErrorGuidance(
  providerName: string,
  status: number,
  errorText: string,
): string | null {
  if (providerName === 'Cerebras') {
    if (
      status === 404 &&
      (errorText.includes('model_not_found') ||
        errorText.includes('does not exist or you do not have access'))
    ) {
      return [
        '**Modelo indisponível na Cerebras para esta chave**\n',
        'A listagem de modelos (`GET /v1/models`) pode incluir IDs que **não estão habilitados** para `POST /v1/chat/completions` na sua conta — a documentação trata descoberta de modelos e uso no chat como fluxos distintos.\n',
        '**O que fazer:**',
        '- Use **llama3.1-8b** ou **qwen-3-235b-a22b-instruct-2507** se o app ainda não tiver feito fallback automático',
        '- Confira permissões e tier em [cloud.cerebras.ai](https://cloud.cerebras.ai/)',
        '- Se o erro persistir com o mesmo `model` que aparece na lista, envie ao suporte Cerebras um `curl` mínimo (sem expor a chave) mostrando 404 no chat e sucesso em outro modelo com o mesmo token',
      ].join('\n')
    }
  }

  // --- OpenRouter specific ---
  if (providerName === 'OpenRouter') {
    // Guardrail restrictions
    if (status === 404 && errorText.includes('No endpoints available')) {
      return [
        '⚠️ **Erro de configuração no OpenRouter**\n',
        'Seus guardrails de privacidade estão bloqueando este modelo.\n',
        '**Para resolver:**',
        '1. Acesse https://openrouter.ai/workspaces/default/guardrails',
        '2. Desative **"ZDR Endpoints Only"**',
        '3. Ative os toggles: *Enable paid endpoints*, *Enable free endpoints that may train on inputs*, *Enable free endpoints that may publish prompts*',
        '4. Em "Provider Restrictions", deixe *Ignored Providers* e *Allowed Providers* vazios',
        '5. Confirme no **Eligibility Preview** que mostra **0 unavailable**',
      ].join('\n')
    }

    // Rate limit with model name
    if (status === 429) {
      const modelMatch = /([\w/.:]+) is temporarily rate-limited/.exec(errorText)
      const modelName = modelMatch?.[1] ?? 'Este modelo'
      return [
        `⏳ **${modelName}** atingiu o limite de requisições temporariamente.\n`,
        '**O que fazer:**',
        '- Aguarde alguns segundos e tente novamente',
        '- Modelos gratuitos (`:free`) têm limites mais baixos',
        '- Para limites maiores, adicione sua própria API key em https://openrouter.ai/settings/integrations',
      ].join('\n')
    }
  }

  if (providerName === 'NVIDIA NIM') {
    if (status === 404 && isUpstreamModelNotFound(status, errorText)) {
      return [
        '**Modelo NVIDIA NIM indisponível para esta chave**\n',
        'A API da NVIDIA listou o modelo, mas o endpoint de chat retornou 404 para a função interna desse modelo na sua conta.',
        '**O que fazer:**',
        '- Tente outro modelo NVIDIA NIM no seletor',
        '- O ModelHub tenta fallback automático para modelos NIM mais estáveis quando possível',
        '- Se o erro persistir, gere uma nova chave em build.nvidia.com e confirme que ela pertence ao mesmo projeto/conta',
      ].join('\n')
    }
  }

  // --- Generic rate limit for any provider ---
  if (status === 429) {
    return `⏳ **${providerName}** atingiu o limite de requisições. Aguarde alguns segundos e tente novamente.`
  }

  return null
}
