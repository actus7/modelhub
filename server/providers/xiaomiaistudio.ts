import type { ChatMessage, ProviderModel } from '../lib/provider-core'
import { buildOpenAiCompatibleChatBody } from '../lib/openai-compatible'
import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  upstreamErrorResponse,
} from '../lib/provider-core'
import { ensureDebugAccess, ensureProtectedAccess } from '../lib/security'
import { prisma } from '../lib/db'
import { encryptCredential } from '../lib/crypto'
import {
  getCooldownRemainingMs,
  rateLimitCooldownKey,
  recordRateLimit,
} from '../lib/rate-limit-cooldown'
import { scrubSecrets } from '../lib/secret-scrub'
import { z } from 'zod'

const XIAOMI_STUDIO_COOKIE = 'XIAOMI_STUDIO_COOKIE'
const XIAOMI_STUDIO_CHAT_URL =
  process.env.XIAOMI_STUDIO_CHAT_URL || 'https://api.xiaomimimo.com/v1/chat/completions'
const XIAOMI_STUDIO_MODELS_URL =
  process.env.XIAOMI_STUDIO_MODELS_URL || 'https://api.xiaomimimo.com/v1/models'
const TIMEOUT_MS = 120000

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

export const XIAOMI_STUDIO_MODELS: ProviderModel[] = [
  {
    capabilities: { documents: true, images: false, tools: true },
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro (AI Studio)',
  },
  {
    capabilities: { documents: true, images: false, tools: true },
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro (AI Studio)',
  },
  {
    capabilities: { documents: true, images: false, tools: true, fast: true },
    id: 'mimo-v2.5',
    name: 'MiMo V2.5 (AI Studio)',
  },
  {
    capabilities: { documents: true, images: true, tools: true },
    id: 'mimo-v2-omni',
    name: 'MiMo V2 Omni (AI Studio)',
  },
  {
    capabilities: { documents: true, images: false, tools: true, fast: true },
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash (AI Studio)',
  },
]

function buildApiHeaders(cookie: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': UA,
    Origin: 'https://aistudio.xiaomimimo.com',
    Referer: 'https://aistudio.xiaomimimo.com/',
    Cookie: cookie,
  }
}

export async function fetchXiaomiStudioModels(
  credentials?: Record<string, string>,
): Promise<ProviderModel[]> {
  try {
    const cookie = resolveEnv(XIAOMI_STUDIO_COOKIE, credentials)
    const response = await fetchWithTimeout(
      XIAOMI_STUDIO_MODELS_URL,
      {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Origin: 'https://aistudio.xiaomimimo.com',
          Cookie: cookie,
        },
      },
      15000,
    )

    if (!response.ok) {
      console.warn(
        `[Xiaomi AI Studio] Models API returned ${response.status}, using static list.`,
      )
      return [...XIAOMI_STUDIO_MODELS]
    }

    const json = (await response.json()) as {
      data?: Array<{ id: string; name?: string }>
    }

    if (!json || !Array.isArray(json.data) || json.data.length === 0) {
      return [...XIAOMI_STUDIO_MODELS]
    }

    return json.data
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({
        capabilities: {
          documents: true,
          images: m.id.includes('omni'),
          tools: true,
        },
        id: m.id,
        name: `${m.name || m.id} (AI Studio)`,
      }))
  } catch (error) {
    console.warn(
      '[Xiaomi AI Studio] Failed to fetch models:',
      error instanceof Error ? error.message : error,
    )
    return [...XIAOMI_STUDIO_MODELS]
  }
}

const oauthStartBodySchema = z.object({
  redirectUri: z.string().optional(),
})

/**
 * OAuth paste-code flow (igual Anthropic no manifest-main):
 *
 * 1. POST /oauth/start  → retorna instrucoes e um state token
 * 2. Usuario faz login em https://aistudio.xiaomimimo.com no navegador
 * 3. Usuario copia o cookie de sessao (DevTools > Application > Cookies)
 * 4. POST /oauth/exchange → envia state + cookie, servidor valida e armazena
 */
async function handleOAuthStart(c: import('hono').Context) {
  const body = await c.req.json().catch(() => ({}))
  const parsed = oauthStartBodySchema.safeParse(body)
  const redirectUri = parsed.success ? parsed.data.redirectUri : undefined

  const state = globalThis.crypto.randomUUID()
  const loginUrl = 'https://aistudio.xiaomimimo.com'

  return c.json({
    state,
    loginUrl,
    redirectUri: redirectUri ?? null,
    instructions: {
      title: 'Conectar Xiaomi AI Studio',
      steps: [
        `1. Abra ${loginUrl} no seu navegador`,
        '2. Faca login com sua conta Xiaomi/Mi',
        '3. Apos logar, abra DevTools (F12) > Application > Cookies',
        '4. Copie todos os cookies do dominio aistudio.xiaomimimo.com como uma unica string',
        `5. Envie o state "${state}" e o cookie para POST /xiaomiaistudio/oauth/exchange`,
      ],
    },
  })
}

const oauthExchangeBodySchema = z.object({
  state: z.string().min(1),
  cookie: z.string().min(1),
})

async function handleOAuthExchange(c: import('hono').Context) {
  const userId = c.get('userId') as string | undefined
  if (!userId) {
    return c.json({ ok: false, error: 'Authentication required.' }, 401)
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = oauthExchangeBodySchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'state e cookie sao obrigatorios.', issues: parsed.error.issues },
      400,
    )
  }

  const { cookie } = parsed.data

  try {
    const response = await fetchWithTimeout(
      XIAOMI_STUDIO_MODELS_URL,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Cookie: cookie,
        },
      },
      15000,
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return c.json({
        ok: false,
        error:
          response.status === 401 || response.status === 403
            ? 'Cookie invalido ou sessao expirada. Regenere o cookie em aistudio.xiaomimimo.com.'
            : `API retornou ${response.status}: ${scrubSecrets(errorText).slice(0, 200)}`,
      }, 400)
    }

    const encrypted = encryptCredential(cookie)

    const existing = await prisma.providerCredential.findFirst({
      where: {
        userId,
        providerId: 'xiaomiaistudio',
        credentialKey: XIAOMI_STUDIO_COOKIE,
      },
    })

    if (existing) {
      await prisma.providerCredential.update({
        where: { id: existing.id },
        data: { credentialValue: encrypted },
      })
    } else {
      await prisma.providerCredential.create({
        data: {
          userId,
          providerId: 'xiaomiaistudio',
          credentialKey: XIAOMI_STUDIO_COOKIE,
          credentialValue: encrypted,
        },
      })
    }

    return c.json({ ok: true, message: 'Sessao Xiaomi AI Studio conectada com sucesso.' })
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Erro ao validar cookie.',
      },
      500,
    )
  }
}

const app = createProviderApp({
  providerId: 'xiaomiaistudio',
  basePath: '/xiaomiaistudio',
  models: XIAOMI_STUDIO_MODELS,
  defaultModel: XIAOMI_STUDIO_MODELS[0].id,
  fetchModels: fetchXiaomiStudioModels,
  chat: async (
    messages: ChatMessage[],
    modelId: string,
    rawBody: Record<string, unknown>,
    credentials: Record<string, string>,
  ) => {
    try {
      const cookie = resolveEnv(XIAOMI_STUDIO_COOKIE, credentials)
      const headers = buildApiHeaders(cookie)

      // Mesmo comportamento de cooldown do chatViaOpenAiCompatible (o chat usa
      // cookie de sessão em vez de Bearer, então não passa pelo caminho padrão).
      const cooldownKey = rateLimitCooldownKey('Xiaomi AI Studio', modelId)
      const cooldownRemainingMs = getCooldownRemainingMs(cooldownKey)
      if (cooldownRemainingMs > 0) {
        const waitSeconds = Math.ceil(cooldownRemainingMs / 1000)
        return toVercelSingleTextResponse(
          `⏳ **Xiaomi AI Studio** está em cooldown de rate limit para o modelo \`${modelId}\`. Tente novamente em ~${waitSeconds}s.`,
        )
      }

      const body = buildOpenAiCompatibleChatBody({
        messages,
        modelId,
        rawBody,
      })

      const response = await postJsonWithTimeout(XIAOMI_STUDIO_CHAT_URL, {
        headers,
        body,
        timeoutMs: TIMEOUT_MS,
      })

      if (response.status === 429) {
        recordRateLimit(cooldownKey, response.headers.get('retry-after'))
      }

      if (response.ok) {
        const contentType = response.headers.get('Content-Type') || ''
        if (contentType.includes('text/event-stream')) {
          return toVercelStreamFromOpenAiSse(response)
        }
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        })
      }

      const errorText = await response.text().catch(() => '')
      return upstreamErrorResponse('Xiaomi AI Studio', response.status, errorText)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        return new Response(
          JSON.stringify({
            error:
              'Xiaomi AI Studio requires a session cookie. ' +
              'Use POST /xiaomiaistudio/oauth/start and /xiaomiaistudio/oauth/exchange to connect.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
      return internalProviderErrorResponse('Xiaomi AI Studio', error)
    }
  },
  testCredentials: async (credentials) => {
    try {
      const cookie = resolveEnv(XIAOMI_STUDIO_COOKIE, credentials)
      const response = await fetchWithTimeout(
        XIAOMI_STUDIO_MODELS_URL,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            Cookie: cookie,
          },
        },
        15000,
      )

      if (response.ok) {
        return { ok: true }
      }

      const errorText = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Cookie de sessao invalido ou expirado. Regenere em aistudio.xiaomimimo.com.' }
      }
      return { ok: false, error: `Erro ${response.status}: ${scrubSecrets(errorText).slice(0, 200)}` }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        return { ok: false, error: 'Cookie de sessao nao configurado. Use o fluxo OAuth em /xiaomiaistudio/oauth/start.' }
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido.' }
    }
  },
})

/** OAuth paste-code endpoints (igual ao padrao do manifest-main para Anthropic) */
app.use('/oauth/*', async (c, next) => {
  const accessError = await ensureProtectedAccess(c, { providerId: 'xiaomiaistudio' })
  if (accessError) {
    return accessError
  }
  await next()
})

app.post('/oauth/start', (c) => handleOAuthStart(c))
app.post('/oauth/exchange', (c) => handleOAuthExchange(c))

app.get('/debug/test', async (c) => {
  const debugError = await ensureDebugAccess(c, {
    providerId: 'xiaomiaistudio',
  })
  if (debugError) {
    return debugError
  }

  try {
    const cookie = resolveEnv(XIAOMI_STUDIO_COOKIE)
    const response = await fetchWithTimeout(
      XIAOMI_STUDIO_MODELS_URL,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Cookie: cookie,
        },
      },
      10000,
    )
    const bodyText = await response.text()
    return c.json({
      ok: response.ok,
      status: response.status,
      bodyPreview: bodyText.substring(0, 500),
    })
  } catch (error) {
    return internalProviderErrorResponse('Xiaomi AI Studio debug', error)
  }
})

export default app.fetch
