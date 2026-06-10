/**
 * Particularidades por provedor portadas do Manifest
 * (packages/backend/src/routing/proxy/provider-client-converters.ts e
 * cache-injection.ts). Cada função opera sobre o body OpenAI-compatible
 * já montado (saída de buildOpenAiCompatibleChatBody) e devolve o mesmo
 * body mutado, para uso direto em `bodyTransform`.
 */

/** Mistral só aceita tool call IDs no formato exato [A-Za-z0-9]{9}. */
const MISTRAL_TOOL_CALL_ID_RE = /^[A-Za-z0-9]{9}$/

/** DeepSeek rejeita max_tokens acima de 8192. */
export const DEEPSEEK_MAX_TOKENS_LIMIT = 8192

/** o-series e GPT-5+ exigem max_completion_tokens no lugar de max_tokens. */
const OPENAI_MAX_COMPLETION_TOKENS_RE = /^(o\d|gpt-5)/i

const CACHE_CONTROL = { type: 'ephemeral' } as const

type Body = Record<string, unknown>

/**
 * Reescreve tool call IDs fora do padrão da Mistral, mantendo consistência
 * entre a mensagem assistant (tool_calls[].id) e as respostas tool
 * (tool_call_id) ao longo de todo o histórico.
 */
export function normalizeMistralToolCallIds(body: Body): Body {
  const messages = body.messages as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(messages)) return body

  const idMap = new Map<string, string>()
  const reservedIds = new Set<string>()
  let generatedCounter = 0

  // Primeiro passe: reserva IDs já válidos para não gerar colisões.
  for (const message of messages) {
    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls as Array<Record<string, unknown>>) {
        if (typeof toolCall?.id === 'string' && MISTRAL_TOOL_CALL_ID_RE.test(toolCall.id)) {
          reservedIds.add(toolCall.id)
        }
      }
    }
    if (typeof message.tool_call_id === 'string' && MISTRAL_TOOL_CALL_ID_RE.test(message.tool_call_id)) {
      reservedIds.add(message.tool_call_id)
    }
  }

  const nextGeneratedId = (): string => {
    while (true) {
      generatedCounter += 1
      const candidate = `tc${generatedCounter.toString(36).padStart(7, '0')}`
      if (!reservedIds.has(candidate)) return candidate
    }
  }

  const normalizeId = (id: unknown): unknown => {
    if (typeof id !== 'string') return id
    const existing = idMap.get(id)
    if (existing) return existing

    if (MISTRAL_TOOL_CALL_ID_RE.test(id)) {
      idMap.set(id, id)
      return id
    }

    const rewritten = nextGeneratedId()
    idMap.set(id, rewritten)
    reservedIds.add(rewritten)
    return rewritten
  }

  for (const message of messages) {
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls = (message.tool_calls as Array<Record<string, unknown>>).map((tc) =>
        tc && typeof tc === 'object' ? { ...tc, id: normalizeId(tc.id) } : tc,
      )
    }
    if (message.tool_call_id !== undefined) {
      message.tool_call_id = normalizeId(message.tool_call_id)
    }
  }

  return body
}

/** Reduz silenciosamente max_tokens ao limite do provedor (ex.: DeepSeek 8192). */
export function capMaxTokens(body: Body, limit: number): Body {
  if (typeof body.max_tokens === 'number' && body.max_tokens > limit) {
    body.max_tokens = limit
  }
  return body
}

/**
 * Renomeia max_tokens → max_completion_tokens para modelos OpenAI o-series /
 * GPT-5+ (aplica também ao GitHub Copilot, que proxia esses modelos à OpenAI).
 * O modelId pode vir prefixado (ex.: "copilot/gpt-5-mini").
 */
export function renameMaxTokensForOpenAi(body: Body, modelId: string): Body {
  const bareModel = modelId.split('/').pop() ?? modelId
  if (!OPENAI_MAX_COMPLETION_TOKENS_RE.test(bareModel)) return body
  if (body.max_tokens === undefined) return body

  if (body.max_completion_tokens === undefined) {
    body.max_completion_tokens = body.max_tokens
  }
  delete body.max_tokens
  return body
}

/**
 * Injeta breakpoints de prompt caching (Anthropic) em requests via OpenRouter
 * para modelos "anthropic/*": cache_control na última mensagem system e na
 * última tool definition. O OpenRouter repassa ao backend da Anthropic e o
 * cache reduz custo de input em conversas longas.
 */
export function injectOpenRouterCacheControl(body: Body, modelId: string): Body {
  if (!/^anthropic\//i.test(modelId)) return body

  const messages = body.messages as Array<Record<string, unknown>> | undefined
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      if (msg.role !== 'system' && msg.role !== 'developer') continue

      if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content, cache_control: CACHE_CONTROL }]
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const blocks = msg.content as Array<Record<string, unknown>>
        blocks[blocks.length - 1]!.cache_control = CACHE_CONTROL
      }
      break
    }
  }

  const tools = body.tools as Array<Record<string, unknown>> | undefined
  if (Array.isArray(tools) && tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: CACHE_CONTROL }
    body.tools = tools
  }

  return body
}
