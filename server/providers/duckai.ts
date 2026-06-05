import { createHash, randomUUID, webcrypto } from 'node:crypto'
import {
  createProviderApp,
  fetchWithTimeout,
  getCookieHeaderValue,
  internalProviderErrorResponse,
  jsonErrorResponse,
  messageContentAsText,
  upstreamErrorResponse,
  type ChatMessage,
  type ProviderModel,
} from '../lib/provider-core'
import {
  deobfuscateChallenge,
  solveVqdChallengeWithBrowser,
  type VqdChallengeResult,
} from './duckai-challenge'

export const DUCKAI_MODELS = [
  { capabilities: { documents: true, images: true }, id: 'gpt-4o-mini', name: 'GPT-4o Mini (Duck.ai)' },
  { capabilities: { documents: true, images: true }, id: 'gpt-5-mini', name: 'GPT-5 Mini (Duck.ai)' },
  { capabilities: { documents: true, images: true }, id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Duck.ai)' },
  { capabilities: { documents: true, images: false }, id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout (Duck.ai)' },
  { capabilities: { documents: true, images: false }, id: 'mistralai/Mistral-Small-24B-Instruct-2501', name: 'Mistral Small 3 (Duck.ai)' },
  { capabilities: { documents: true, images: false }, id: 'tinfoil/gpt-oss-120b', name: 'GPT-OSS 120B (Duck.ai)' },
]

const MODELS_URL = 'https://duck.ai/duckchat/v1/models'
const AUTH_TOKEN_URL = 'https://duck.ai/duckchat/v1/auth/token'
const STATUS_URL = 'https://duck.ai/duckchat/v1/status'
const CHAT_URL = 'https://duck.ai/duckchat/v1/chat'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
const JSDOM_MAX_RETRIES = 4
const DUCKAI_TEMPORARY_ERROR_MESSAGE =
  'Duck.ai is temporarily unavailable. Please try again in a few moments.'
const DUCKAI_CHAT_MAX_ATTEMPTS = readNumberEnv('DUCKAI_CHAT_MAX_ATTEMPTS', 5)
const DUCKAI_CHAT_RETRY_BASE_DELAY_MS = readNumberEnv(
  'DUCKAI_CHAT_RETRY_BASE_DELAY_MS',
  750,
)
const DUCKAI_CHAT_RETRY_MAX_DELAY_MS = readNumberEnv(
  'DUCKAI_CHAT_RETRY_MAX_DELAY_MS',
  5000,
)

type DdgMessage = { role: 'user' | 'assistant'; content: string }
type DuckAiReasoningEffort = 'minimal' | 'low'
type DuckAiRetryClass = 'bn_limit' | 'challenge' | 'empty_stream' | 'network' | 'timeout'
type DuckAiRetryPhase = 'chat_http' | 'chat_stream_prelude' | 'vqd'
type DuckAiChallengeRuntime = 'browser' | 'jsdom-dangerous' | 'off'
type JsdomCtor = (typeof import('jsdom'))['JSDOM']
type JsdomWindowLike = typeof globalThis & {
  HTMLFrameElement?: { prototype: unknown }
  HTMLIFrameElement?: { prototype: unknown }
  MutationObserver?: typeof MutationObserver
  __challengeResult?: Promise<unknown>
}
type JsdomLike = { window: unknown }
type DuckAiChatDeps = {
  buildDuckAiDurableStreamPayload: typeof buildDuckAiDurableStreamPayload
  getReasoningEffort: typeof getReasoningEffort
  getVqdData: typeof getVqdData
  sendChatRequest: typeof sendDuckAiChatRequest
  sleep: typeof sleep
}
type DuckAiLogPayload = {
  attempt?: number
  browserFallbackUsed?: boolean
  delayMs?: number
  finalOutcome: 'error' | 'exhausted' | 'retrying' | 'success'
  jsdomAttempts?: number
  phase: 'chat_http' | 'chat_stream' | 'chat_stream_prelude' | 'vqd'
  reusedVqd?: boolean
  retryClass?: DuckAiRetryClass
  status?: number
  type?: string
  overrideCode?: string
}
type DuckAiModelMetadata = {
  accessTier?: string[]
  /** When false, Duck.ai will reject chat for this model for the anonymous session. */
  entityHasAccess?: boolean
  id: string
  name: string
  supportedReasoningEffort?: DuckAiReasoningEffort[]
}
type DuckAiSseEvent =
  | { kind: 'content'; content: string }
  | {
      kind: 'error'
      message: string
      overrideCode?: string
      retryClass?: DuckAiRetryClass
      type?: string
    }
type DuckAiUpstreamErrorInfo = {
  overrideCode?: string
  status?: number
  type?: string
}
type DuckAiVqdData = {
  browserFallbackUsed: boolean
  cookies: string
  hashPayload: string
  jsdomAttempts: number
}
type PrimedDuckAiStreamResult =
  | { response: Response }
  | { retryableError: DuckAiRetryableError }
  | { errorResponse: Response }
type DuckAiChatAttemptContext = {
  activeVqdData: DuckAiVqdData
  attempt: number
  deps: DuckAiChatDeps
  reusedVqd: boolean
}
type DuckAiChatAttemptResult =
  | { kind: 'response'; response: Response }
  | { kind: 'retry'; refreshVqd: boolean }
  | { kind: 'error'; response: Response }

let duckAiModelMetadataPromise: Promise<DuckAiModelMetadata[]> | null = null
let jsdomCtorPromise: Promise<JsdomCtor> | null = null

class DuckAiRetryableError extends Error {
  constructor(
    message: string,
    readonly info: {
      overrideCode?: string
      phase: DuckAiRetryPhase
      retryClass: DuckAiRetryClass
      status?: number
      type?: string
    },
  ) {
    super(message)
    this.name = 'DuckAiRetryableError'
  }
}

async function getJsdomCtor(): Promise<JsdomCtor> {
  if (!jsdomCtorPromise) {
    jsdomCtorPromise = import('jsdom').then((mod) => mod.JSDOM)
  }

  return jsdomCtorPromise
}

function isJsdomUnavailableError(error: Error): boolean {
  return (
    error.message.includes('Failed to load external module jsdom') ||
    error.message.includes('ERR_REQUIRE_ESM') ||
    (error as NodeJS.ErrnoException).code === 'ENOENT' ||
    error.message.includes('default-stylesheet.css') ||
    (error.message.includes('ENOENT') && error.message.includes('jsdom'))
  )
}

/** SHA-256 of a string, returned as base64 (sync, using node:crypto) */
function sha256Base64(text: string): string {
  return createHash('sha256').update(text).digest('base64')
}

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) return fallback

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDuckAiChallengeRuntime(): DuckAiChallengeRuntime {
  const rawRuntime = process.env.DUCKAI_CHALLENGE_RUNTIME?.trim().toLowerCase()
  if (rawRuntime === 'browser' || rawRuntime === 'puppeteer') return 'browser'
  if (rawRuntime === 'off' || rawRuntime === 'disabled') return 'off'
  if (
    rawRuntime === 'jsdom-dangerous' &&
    process.env.DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE === 'true'
  ) {
    return 'jsdom-dangerous'
  }

  const legacyBrowserFallback = process.env.DUCKAI_BROWSER_FALLBACK?.trim().toLowerCase()
  if (legacyBrowserFallback === '0' || legacyBrowserFallback === 'false') return 'off'
  if (legacyBrowserFallback === '1' || legacyBrowserFallback === 'true') return 'browser'

  if (process.env.DUCKAI_BROWSER_WS_ENDPOINT?.trim()) {
    return 'browser'
  }

  // Local/dev can use the bundled Puppeteer browser. Vercel should use
  // DUCKAI_BROWSER_WS_ENDPOINT or an explicit runtime setting.
  return process.env.VERCEL ? 'off' : 'browser'
}

function mergeCookies(...cookieHeaders: Array<string | undefined>): string {
  const cookieMap = new Map<string, string>()

  for (const header of cookieHeaders) {
    if (!header) continue

    for (const part of header.split(/;\s*/)) {
      const [name, ...valueParts] = part.split('=')
      if (!name || valueParts.length === 0) continue
      cookieMap.set(name, valueParts.join('='))
    }
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function appendResponseCookies(existingCookies: string, headers: Headers): string {
  return mergeCookies(existingCookies, getCookieHeaderValue(headers))
}

function getDuckAiRetryDelay(attempt: number, retryClass: DuckAiRetryClass): number {
  const isBnLimit = retryClass === 'bn_limit'
  const baseDelayMs = isBnLimit ? Math.max(DUCKAI_CHAT_RETRY_BASE_DELAY_MS * 4, 3000) : DUCKAI_CHAT_RETRY_BASE_DELAY_MS
  const maxDelayMs = isBnLimit ? Math.max(DUCKAI_CHAT_RETRY_MAX_DELAY_MS * 3, baseDelayMs) : DUCKAI_CHAT_RETRY_MAX_DELAY_MS
  const computed = baseDelayMs * 2 ** Math.max(0, attempt - 1)
  return Math.min(computed, maxDelayMs)
}

function shouldRefreshDuckAiVqd(retryClass: DuckAiRetryClass): boolean {
  return retryClass === 'challenge'
}

function logDuckAi(scope: 'challenge' | 'chat', level: 'error' | 'log' | 'warn', payload: DuckAiLogPayload): void {
  console[level](`[Duck.ai][${scope}] ${JSON.stringify(payload)}`)
}

function parseDuckAiUpstreamError(raw: string, status?: number): DuckAiUpstreamErrorInfo {
  if (!raw.trim()) {
    return { status }
  }

  try {
    const parsed = JSON.parse(raw) as {
      overrideCode?: unknown
      status?: unknown
      type?: unknown
    }

    return {
      overrideCode: typeof parsed.overrideCode === 'string' ? parsed.overrideCode : undefined,
      status:
        typeof parsed.status === 'number'
          ? parsed.status
          : typeof status === 'number'
            ? status
            : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
    }
  } catch {
    return {
      status,
      type: raw.includes('ERR_BN_LIMIT')
        ? 'ERR_BN_LIMIT'
        : raw.includes('ERR_CHALLENGE')
          ? 'ERR_CHALLENGE'
          : undefined,
    }
  }
}

function isRetryableDuckAiHttpFailure(status: number, raw: string): {
  info: DuckAiUpstreamErrorInfo
  retryClass?: DuckAiRetryClass
  retryable: boolean
} {
  const info = parseDuckAiUpstreamError(raw, status)
  const isBnLimit = info.type === 'ERR_BN_LIMIT' || raw.includes('ERR_BN_LIMIT')
  const isChallenge =
    !isBnLimit && (status === 418 || info.type === 'ERR_CHALLENGE' || raw.includes('ERR_CHALLENGE'))

  return {
    info,
    retryClass: isBnLimit ? 'bn_limit' : isChallenge ? 'challenge' : undefined,
    retryable: isBnLimit || isChallenge,
  }
}

function isRetryableDuckAiThrownError(error: unknown): DuckAiRetryableError | null {
  if (error instanceof DuckAiRetryableError) {
    return error
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new DuckAiRetryableError('Duck.ai request timed out before producing output.', {
      phase: 'chat_http',
      retryClass: 'timeout',
    })
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ERR_BN_LIMIT')) {
    return new DuckAiRetryableError(message, {
      overrideCode: parseDuckAiUpstreamError(message).overrideCode,
      phase: 'chat_http',
      retryClass: 'bn_limit',
      status: 418,
      type: 'ERR_BN_LIMIT',
    })
  }

  if (
    message.includes('VQD challenge failed after') ||
    message.includes('Could not find Chrome') ||
    message.includes('Failed to load external module jsdom') ||
    message.includes('ERR_REQUIRE_ESM')
  ) {
    return new DuckAiRetryableError(message, {
      phase: 'vqd',
      retryClass: 'challenge',
    })
  }

  if (message.toLowerCase().includes('fetch failed')) {
    return new DuckAiRetryableError(message, {
      phase: 'chat_http',
      retryClass: 'network',
    })
  }

  return null
}

function createDuckAiTemporaryUnavailableResponse(): Response {
  return jsonErrorResponse(503, DUCKAI_TEMPORARY_ERROR_MESSAGE)
}

function createDuckAiStreamEvent(rawChunk: string): DuckAiSseEvent | null {
  const json = rawChunk.replace(/^data:\s*/, '')
  if (!isJson(json)) {
    return null
  }

  const parsed = JSON.parse(json) as {
    action?: string
    content?: string
    message?: string
    overrideCode?: string
    role?: string
    type?: string
  }

  if (parsed.action === 'error') {
    const message = parsed.type ?? parsed.message ?? 'Duck.ai stream returned an error event'
    const retryClass =
      parsed.type === 'ERR_BN_LIMIT' || message.includes('ERR_BN_LIMIT')
        ? 'bn_limit'
        : parsed.type === 'ERR_CHALLENGE' || message.includes('ERR_CHALLENGE')
          ? 'challenge'
          : undefined
    return {
      kind: 'error',
      message,
      overrideCode: parsed.overrideCode,
      retryClass,
      type: parsed.type,
    }
  }

  const content =
    typeof parsed.message === 'string'
      ? parsed.message
      : parsed.role === 'assistant' && typeof parsed.content === 'string'
        ? parsed.content
        : ''

  return content ? { content, kind: 'content' } : null
}

function extractDuckAiSseChunks(
  buffer: string,
  flush = false,
): { chunks: string[]; rest: string } {
  if (flush) {
    const finalChunk = buffer.trim()
    return {
      chunks: finalChunk ? [finalChunk] : [],
      rest: '',
    }
  }

  const parts = buffer.split('\n\n')
  return {
    chunks: parts.slice(0, -1).filter((part) => part.startsWith('data: ')),
    rest: parts.at(-1) ?? '',
  }
}

/**
 * Patch the jsdom environment so the Duck.ai challenge script can use iframes.
 *
 * The challenge script accesses iframe content in multiple ways depending on
 * the version DuckDuckGo serves:
 *   1. `iframe.contentDocument` / `iframe.contentWindow`
 *   2. `window.frames[0]` or `window[0]` (the frames collection)
 *
 * jsdom doesn't populate `window.frames` / numeric window indices and returns
 * null for `contentDocument` on un-navigated iframes.  We patch both paths so
 * the challenge always gets usable stub objects instead of crashing.
 */
function patchJsdomForIframes(dom: JsdomLike): void {
  const win = dom.window as JsdomWindowLike
  const frameConstructors = [win.HTMLIFrameElement, win.HTMLFrameElement].filter(Boolean) as Array<{
    prototype: unknown
  }>
  if (frameConstructors.length === 0) return

  const frameStates = new WeakMap<object, { doc: Document; win: Window & typeof globalThis }>()
  const createFrameState = (frameElement: unknown) => {
    const doc = win.document.implementation.createHTMLDocument('')
    const frameWin = Object.create(win) as Window & typeof globalThis

    Object.defineProperties(frameWin, {
      contentDocument: {
        configurable: true,
        enumerable: true,
        get: () => doc,
      },
      document: {
        configurable: true,
        enumerable: true,
        get: () => doc,
      },
      frameElement: {
        configurable: true,
        enumerable: true,
        get: () => frameElement ?? null,
      },
      parent: {
        configurable: true,
        enumerable: true,
        get: () => win,
      },
      self: {
        configurable: true,
        enumerable: true,
        get: () => frameWin,
      },
      top: {
        configurable: true,
        enumerable: true,
        get: () => win,
      },
      window: {
        configurable: true,
        enumerable: true,
        get: () => frameWin,
      },
    })

    return { doc, win: frameWin }
  }
  const defaultFrameState = createFrameState(null)
  const getFrameState = (frameElement: unknown) => {
    if (!frameElement || typeof frameElement !== 'object') {
      return defaultFrameState
    }

    let state = frameStates.get(frameElement)
    if (!state) {
      state = createFrameState(frameElement)
      frameStates.set(frameElement, state)
    }
    return state
  }
  const installFrameAccessors = (target: Record<string, unknown>) => {
    Object.defineProperty(target, 'contentDocument', {
      configurable: true,
      enumerable: true,
      get() {
        return getFrameState(this).doc
      },
    })

    Object.defineProperty(target, 'contentWindow', {
      configurable: true,
      enumerable: true,
      get() {
        return getFrameState(this).win
      },
    })
  }

  // -- 1. Patch prototype-level contentDocument / contentWindow ---------------
  for (const FrameClass of frameConstructors) {
    installFrameAccessors(FrameClass.prototype as Record<string, unknown>)
  }

  // -- 2. Patch window.frames / window[0] ------------------------------------
  // The challenge may access the iframe via `window.frames[0]` or `window[0]`.
  // In a real browser these return the iframe's contentWindow.  We use a Proxy
  // on the frames collection so any numeric index returns our stub window, which
  // has the patched contentDocument.
  const framesProxy = new Proxy([] as unknown[], {
    get(_target, prop) {
      if (prop === 'length') return 1
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return defaultFrameState.win
      return undefined
    },
  })

  try {
    Object.defineProperty(win, 'frames', {
      configurable: true,
      enumerable: true,
      get: () => framesProxy,
    })
  } catch {
    // Some jsdom versions freeze window.frames — ignore
  }

  // window[0] access (numeric index on window itself)
  try {
    Object.defineProperty(win, '0', {
      configurable: true,
      enumerable: false,
      get: () => defaultFrameState.win,
    })
  } catch {
    // ignore
  }

  // -- 3. Helper to force-patch a single iframe instance -----------------------
  // webidl2js may (re-)define own-property descriptors on iframe instances when
  // they are created or inserted into the DOM, shadowing our prototype getters.
  // This helper unconditionally overrides the instance-level descriptors.
  const patchIframeInstance = (el: unknown) => {
    getFrameState(el)
    installFrameAccessors(el as Record<string, unknown>)
  }

  // -- 4. Patch document.createElement to set instance properties on iframes -
  const origCreateElement = win.document.createElement.bind(win.document)
  win.document.createElement = function (
    tagName: string,
    options?: ElementCreationOptions,
  ) {
    const el = origCreateElement(tagName, options)
    if (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'frame') {
      patchIframeInstance(el)
    }
    return el
  } as typeof win.document.createElement

  // -- 5. MutationObserver to re-patch iframes after DOM insertion ------------
  // jsdom's webidl2js layer may redefine own-property descriptors when an
  // element is inserted into the live DOM tree.  A MutationObserver lets us
  // re-apply our getters immediately after insertion.
  const MO = win.MutationObserver
  if (MO) {
    const observer = new MO((mutations: MutationRecord[]) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          const tagName = (node as Element).tagName
          if (tagName === 'IFRAME' || tagName === 'FRAME') patchIframeInstance(node)
          // Also check children (e.g. a div containing an iframe)
          if (typeof (node as Element).querySelectorAll === 'function') {
            for (const iframe of Array.from(
              (node as Element).querySelectorAll('iframe,frame'),
            )) {
              patchIframeInstance(iframe)
            }
          }
        }
      }
    })
    observer.observe(win.document, { childList: true, subtree: true })
  }
}

/**
 * Execute the Duck.ai VQD v4 challenge JS using jsdom.
 * @param useDeobfuscation - when true, injects safety wrappers (as a separate
 *   script) into the DOM before executing the challenge.
 */
async function solveVqdChallenge(
  challengeB64: string,
  useDeobfuscation = false,
): Promise<VqdChallengeResult> {
  const decoded = Buffer.from(challengeB64, 'base64').toString('utf-8')
  const preparedChallenge = useDeobfuscation ? deobfuscateChallenge(decoded) : decoded
  const JSDOM = await getJsdomCtor()

  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://duck.ai/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  })

  // Override navigator properties to match our UA
  Object.defineProperty(dom.window.navigator, 'webdriver', { get: () => false, configurable: true })
  Object.defineProperty(dom.window.navigator, 'userAgent', { get: () => UA, configurable: true })

  // Patch jsdom so the challenge script can use iframes (contentDocument, window.frames, etc.)
  patchJsdomForIframes(dom)

  // Execute the challenge script inside jsdom
  const scriptEl = dom.window.document.createElement('script')
  scriptEl.textContent = `
    window.__challengeResult = (async function() {
      try {
        return await (${preparedChallenge});
      } catch(e) {
        return { __error: e.message, __stack: e.stack };
      }
    })();
  `
  dom.window.document.head.appendChild(scriptEl)

  const result = (await dom.window.__challengeResult) as VqdChallengeResult & {
    __error?: string
    __stack?: string
  }
  dom.window.close()

  if (result?.__error) {
    console.error('[Duck.ai] challenge script stack:', result.__stack)
    console.error('[Duck.ai] challenge preview:', preparedChallenge.slice(0, 500))
    throw new Error(`Challenge execution failed: ${result.__error}`)
  }
  if (!result?.server_hashes) {
    throw new Error('Challenge returned invalid data')
  }
  return result
}

const STATUS_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-store',
  DNT: '1',
  Referer: 'https://duck.ai/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': UA,
  'x-vqd-accept': '1',
}

async function warmDuckAiAuthToken(existingCookies = ''): Promise<{ cookies: string }> {
  const response = await fetchWithTimeout(
    AUTH_TOKEN_URL,
    {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(existingCookies ? { Cookie: existingCookies } : {}),
        DNT: '1',
        Referer: 'https://duck.ai/',
        'User-Agent': UA,
      },
    },
    10000,
  )

  if (!response.ok) {
    throw new Error(`Failed to warm Duck.ai auth token: ${response.status}`)
  }

  return { cookies: appendResponseCookies(existingCookies, response.headers) }
}

/**
 * Build the base64 hash payload from a challenge result.
 */
function buildHashPayload(challengeResult: VqdChallengeResult): string {
  const hashedClientHashes = challengeResult.client_hashes.map((c) => sha256Base64(c))
  const payload = { ...challengeResult, client_hashes: hashedClientHashes }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

/**
 * Fetch a fresh VQD challenge hash from the status endpoint.
 */
async function fetchChallengeHash(seedCookies = ''): Promise<{
  challengeHash: string
  cookies: string
}> {
  const warmed = await warmDuckAiAuthToken(seedCookies)

  const response = await fetchWithTimeout(
    STATUS_URL,
    {
      method: 'GET',
      headers: {
        ...STATUS_HEADERS,
        ...(warmed.cookies ? { Cookie: warmed.cookies } : {}),
      },
    },
    15000,
  )
  if (!response.ok) {
    throw new Error(`Failed to get VQD status: ${response.status}`)
  }

  const rawHash = response.headers.get('x-vqd-hash-1') || ''
  if (!rawHash) {
    throw new Error('No x-vqd-hash-1 header in status response')
  }
  return {
    challengeHash: rawHash,
    cookies: appendResponseCookies(warmed.cookies, response.headers),
  }
}

/**
 * Get the solved hash payload.
 *
 * Safe default: solve the challenge inside Chromium (local Puppeteer in dev or
 * DUCKAI_BROWSER_WS_ENDPOINT in hosted/serverless environments).
 *
 * Legacy jsdom execution is still available only with both:
 * DUCKAI_CHALLENGE_RUNTIME=jsdom-dangerous and
 * DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE=true.
 */
async function getVqdData(seedCookies = ''): Promise<DuckAiVqdData> {
  let cookies = seedCookies
  let lastError: Error | null = null
  let lastChallengeHash: string | null = null
  const challengeRuntime = getDuckAiChallengeRuntime()

  if (challengeRuntime === 'off') {
    throw new Error(
      'Duck.ai VQD challenge runtime is disabled. Set DUCKAI_BROWSER_WS_ENDPOINT ' +
        'or DUCKAI_CHALLENGE_RUNTIME=browser to keep Duck.ai enabled safely.',
    )
  }

  if (challengeRuntime === 'browser') {
    try {
      const challenge = await fetchChallengeHash(cookies)
      cookies = challenge.cookies
      const challengeResult = await solveVqdChallengeWithBrowser(challenge.challengeHash)

      logDuckAi('challenge', 'log', {
        browserFallbackUsed: true,
        finalOutcome: 'success',
        jsdomAttempts: 0,
        phase: 'vqd',
      })
      return {
        browserFallbackUsed: true,
        cookies,
        hashPayload: buildHashPayload(challengeResult),
        jsdomAttempts: 0,
      }
    } catch (browserError) {
      const err = browserError instanceof Error ? browserError : new Error(String(browserError))
      console.error('[Duck.ai] Browser challenge failed:', err.message)
      logDuckAi('challenge', 'error', {
        browserFallbackUsed: true,
        finalOutcome: 'error',
        jsdomAttempts: 0,
        phase: 'vqd',
        retryClass: 'challenge',
      })
      throw new Error(`Duck.ai browser challenge failed: ${err.message}`)
    }
  }

  // Explicit legacy fallback: jsdom runs remote challenge code in Node and is
  // intentionally not reachable unless the deployment opts into that risk.
  for (let attempt = 1; attempt <= JSDOM_MAX_RETRIES; attempt++) {
    try {
      const challenge = await fetchChallengeHash(cookies)
      lastChallengeHash = challenge.challengeHash
      cookies = challenge.cookies

      // The null-contentDocument variant shows up early in production, so
      // enable the guarded rewrite from the second jsdom attempt onward.
      const useDeobfuscation = attempt > 1
      const challengeResult = await solveVqdChallenge(challenge.challengeHash, useDeobfuscation)

      logDuckAi('challenge', 'log', {
        browserFallbackUsed: false,
        finalOutcome: 'success',
        jsdomAttempts: attempt,
        phase: 'vqd',
      })
      return {
        browserFallbackUsed: false,
        cookies,
        hashPayload: buildHashPayload(challengeResult),
        jsdomAttempts: attempt,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (isJsdomUnavailableError(lastError)) {
        console.warn('[Duck.ai] jsdom is unavailable in this runtime.')
        break
      }

      // Only retry on challenge execution failures — network / 429 errors
      // are not worth retrying immediately.
      const isChallengeFail = lastError.message.includes('Challenge execution failed')
      if (!isChallengeFail) {
        throw lastError
      }

      if (attempt < JSDOM_MAX_RETRIES) {
        const delayMs = 1500 * attempt
        logDuckAi('challenge', 'warn', {
          browserFallbackUsed: false,
          delayMs,
          finalOutcome: 'retrying',
          jsdomAttempts: attempt,
          phase: 'vqd',
          retryClass: 'challenge',
        })
        await sleep(delayMs)
      }
    }
  }

  // Legacy jsdom mode failed and will not fall back to another runtime here.
  logDuckAi('challenge', 'error', {
    browserFallbackUsed: false,
    finalOutcome: 'error',
    jsdomAttempts: JSDOM_MAX_RETRIES,
    phase: 'vqd',
    retryClass: 'challenge',
  })
  throw new Error(
    `VQD challenge failed after ${JSDOM_MAX_RETRIES} explicit jsdom-dangerous attempts. ` +
      `Last jsdom error: ${lastError?.message}. Last challenge hash present: ${Boolean(lastChallengeHash)}`,
  )

}

function toDdgMessages(messages: ChatMessage[]): DdgMessage[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: messageContentAsText(m),
  }))
}

function isJson(str: string): boolean {
  try {
    return str !== null && JSON.parse(str) !== null
  } catch {
    return false
  }
}

/** Model IDs known to support image/vision inputs */
const VISION_CAPABLE_IDS = new Set(
  DUCKAI_MODELS.filter((m) => m.capabilities.images).map((m) => m.id),
)

function duckAiModelsFromMetadata(models: DuckAiModelMetadata[]): ProviderModel[] {
  return models
    .filter((m) => m.accessTier?.includes('free'))
    .filter((m) => m.entityHasAccess !== false)
    .map((m) => ({
      capabilities: { documents: true, images: VISION_CAPABLE_IDS.has(m.id) },
      id: m.id,
      name: `${m.name} (Duck.ai)`,
    }))
}

/** Static fallback list (same shape as dynamic) when the API is empty or unreachable. */
function duckAiModelsStaticFallback(): ProviderModel[] {
  return DUCKAI_MODELS.map((m) => ({
    capabilities: m.capabilities,
    id: m.id,
    name: m.name,
  }))
}

export async function fetchDuckAiModels(): Promise<ProviderModel[]> {
  try {
    const models = await fetchDuckAiModelMetadata()
    const mapped = duckAiModelsFromMetadata(models)
    if (mapped.length > 0) {
      return mapped
    }
    console.warn('[Duck.ai] Model list from API was empty after filters; using static fallback.')
  } catch (error) {
    console.warn(
      '[Duck.ai] Failed to load model metadata:',
      error instanceof Error ? error.message : error,
    )
  }

  return duckAiModelsStaticFallback()
}

async function fetchDuckAiModelMetadata(): Promise<DuckAiModelMetadata[]> {
  if (!duckAiModelMetadataPromise) {
    duckAiModelMetadataPromise = (async () => {
      const response = await fetchWithTimeout(
        MODELS_URL,
        { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json' } },
        10000,
      )
      if (!response.ok) throw new Error(`Duck.ai models API returned ${response.status}`)

      const json = (await response.json()) as {
        models?: DuckAiModelMetadata[]
      }

      if (!json.models?.length) throw new Error('Empty models response from Duck.ai')

      return json.models
    })().catch((error) => {
      duckAiModelMetadataPromise = null
      throw error
    })
  }

  return duckAiModelMetadataPromise
}

async function getReasoningEffort(modelId: string): Promise<DuckAiReasoningEffort | undefined> {
  const model = (await fetchDuckAiModelMetadata()).find((candidate) => candidate.id === modelId)
  const efforts = model?.supportedReasoningEffort ?? []

  if (efforts.includes('minimal')) {
    return 'minimal'
  }

  if (efforts.includes('low')) {
    return 'low'
  }

  return undefined
}

function buildDuckAiSignalsHeader(): string {
  const start = Date.now()
  const end = start + 1

  return Buffer.from(JSON.stringify({ end, events: [], start })).toString('base64')
}

function buildDuckAiToolChoice() {
  return {
    LocalSearch: false,
    NewsSearch: false,
    VideosSearch: false,
    WeatherForecast: false,
  }
}

async function buildDuckAiDurableStreamPayload(): Promise<{
  conversationId: string
  messageId: string
  publicKey: JsonWebKey
}> {
  const keyPair = (await webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair

  const publicKey = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)

  return {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    publicKey: {
      ...publicKey,
      alg: 'RSA-OAEP-256',
      ext: true,
      key_ops: ['encrypt'],
      use: 'enc',
    },
  }
}

async function sendDuckAiChatRequest(input: {
  cookies: string
  durableStream: Awaited<ReturnType<typeof buildDuckAiDurableStreamPayload>>
  messages: DdgMessage[]
  modelId: string
  reasoningEffort?: DuckAiReasoningEffort
  vqdData: DuckAiVqdData
}): Promise<{ cookies: string; response: Response }> {
  const chatHeaders: Record<string, string> = {
    ...STATUS_HEADERS,
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    ...(input.cookies ? { Cookie: input.cookies } : {}),
    Origin: 'https://duck.ai',
    'x-fe-signals': buildDuckAiSignalsHeader(),
    'x-vqd-hash-1': input.vqdData.hashPayload,
  }
  const requestBody: Record<string, unknown> = {
    model: input.modelId,
    messages: input.messages,
    canUseTools: true,
    canUseApproxLocation: null,
    durableStream: input.durableStream,
    metadata: {
      toolChoice: buildDuckAiToolChoice(),
    },
  }

  if (input.reasoningEffort) {
    requestBody.reasoningEffort = input.reasoningEffort
  }

  const response = await fetchWithTimeout(
    CHAT_URL,
    {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify(requestBody),
    },
    60000,
  )

  return {
    cookies: appendResponseCookies(input.cookies, response.headers),
    response,
  }
}

async function pumpDuckAiStream(input: {
  initialBuffer: string
  initialChunks: string[]
  reader: ReadableStreamDefaultReader<Uint8Array>
  writer: WritableStreamDefaultWriter<Uint8Array>
}): Promise<void> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = input.initialBuffer
  let pendingChunks = input.initialChunks
  let didFinish = false

  try {
    while (true) {
      if (pendingChunks.length === 0) {
        const { done, value } = await input.reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const extracted = extractDuckAiSseChunks(buffer)
        buffer = extracted.rest
        pendingChunks = extracted.chunks
        if (pendingChunks.length === 0) {
          continue
        }
      }

      const chunksToProcess = pendingChunks
      pendingChunks = []

      for (const rawChunk of chunksToProcess) {
        const event = createDuckAiStreamEvent(rawChunk)
        if (!event) continue

        if (event.kind === 'error') {
          await input.writer.write(encoder.encode(`3:${JSON.stringify(event.message)}\n`))
          await input.writer.write(encoder.encode('d:{"finishReason":"error"}\n'))
          didFinish = true
          return
        }

        await input.writer.write(encoder.encode(`0:${JSON.stringify(event.content)}\n`))
      }
    }

    const remaining = extractDuckAiSseChunks(buffer, true).chunks
    for (const rawChunk of remaining) {
      const event = createDuckAiStreamEvent(rawChunk)
      if (!event) continue

      if (event.kind === 'error') {
        await input.writer.write(encoder.encode(`3:${JSON.stringify(event.message)}\n`))
        await input.writer.write(encoder.encode('d:{"finishReason":"error"}\n'))
        didFinish = true
        return
      }

      await input.writer.write(encoder.encode(`0:${JSON.stringify(event.content)}\n`))
    }

    await input.writer.write(encoder.encode('d:{"finishReason":"stop"}\n'))
    didFinish = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await input.writer.write(encoder.encode(`3:${JSON.stringify(message)}\n`))
    await input.writer.write(encoder.encode('d:{"finishReason":"error"}\n'))
    didFinish = true
  } finally {
    if (!didFinish) {
      await input.writer.write(encoder.encode('d:{"finishReason":"error"}\n')).catch(() => {})
    }
    await input.writer.close().catch(() => {})
  }
}

function classifyDuckAiStreamError(event: DuckAiSseEvent & { kind: 'error' }): PrimedDuckAiStreamResult {
  if (event.retryClass) {
    return {
      retryableError: new DuckAiRetryableError(event.message, {
        overrideCode: event.overrideCode,
        phase: 'chat_stream_prelude',
        retryClass: event.retryClass,
        type: event.type,
      }),
    }
  }

  return {
    errorResponse: upstreamErrorResponse(
      'Duck.ai',
      502,
      JSON.stringify({
        message: event.message,
        overrideCode: event.overrideCode,
        type: event.type,
      }),
    ),
  }
}

async function primeDuckAiStream(chatResponse: Response): Promise<PrimedDuckAiStreamResult> {
  if (!chatResponse.body) {
    return {
      errorResponse: internalProviderErrorResponse('Duck.ai', new Error('No response body')),
    }
  }

  const reader = chatResponse.body.getReader()
  const decoder = new TextDecoder()
  const { readable, writable } = new TransformStream<Uint8Array>()
  const writer = writable.getWriter()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      const finalChunks = extractDuckAiSseChunks(buffer, true).chunks
      for (const rawChunk of finalChunks) {
        const event = createDuckAiStreamEvent(rawChunk)
        if (!event) continue

        if (event.kind === 'error') {
          await reader.cancel().catch(() => {})
          await writer.close().catch(() => {})
          return classifyDuckAiStreamError(event)
        }

        void pumpDuckAiStream({
          initialBuffer: "",
          initialChunks: finalChunks,
          reader,
          writer,
        });
        return {
          response: new Response(readable, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Transfer-Encoding': 'chunked',
              'Cache-Control': 'no-cache',
            },
          }),
        }
      }

      await reader.cancel().catch(() => {})
      await writer.close().catch(() => {})
      return {
        retryableError: new DuckAiRetryableError(
          'Duck.ai stream ended before producing output.',
          {
            phase: 'chat_stream_prelude',
            retryClass: 'empty_stream',
          },
        ),
      }
    }

    buffer += decoder.decode(value, { stream: true })
    const extracted = extractDuckAiSseChunks(buffer)
    buffer = extracted.rest

    for (let index = 0; index < extracted.chunks.length; index++) {
      const rawChunk = extracted.chunks[index]
      const event = createDuckAiStreamEvent(rawChunk)
      if (!event) continue

      if (event.kind === 'error') {
        await reader.cancel().catch(() => {})
        await writer.close().catch(() => {})
        if (event.retryClass) {
          return {
            retryableError: new DuckAiRetryableError(event.message, {
              overrideCode: event.overrideCode,
              phase: 'chat_stream_prelude',
              retryClass: event.retryClass,
              type: event.type,
            }),
          }
        }

        return {
          errorResponse: upstreamErrorResponse(
            'Duck.ai',
            502,
            JSON.stringify({
              message: event.message,
              overrideCode: event.overrideCode,
              type: event.type,
            }),
          ),
        }
      }

      void pumpDuckAiStream({
        initialBuffer: buffer,
        initialChunks: extracted.chunks.slice(index),
        reader,
        writer,
      })
      return {
        response: new Response(readable, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
          },
        }),
      }
    }
  }
}

async function handleDuckAiChatAttempt(
  chatResponse: Response,
  ctx: DuckAiChatAttemptContext,
): Promise<DuckAiChatAttemptResult> {
  if (!chatResponse.ok) {
    const errorText = await chatResponse.text().catch(() => '')
    const classification = isRetryableDuckAiHttpFailure(chatResponse.status, errorText)

    if (classification.retryable && classification.retryClass) {
      const delayMs = getDuckAiRetryDelay(ctx.attempt, classification.retryClass)
      const finalOutcome =
        ctx.attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? 'retrying' : 'exhausted'
      logDuckAi('chat', finalOutcome === 'retrying' ? 'warn' : 'error', {
        attempt: ctx.attempt,
        browserFallbackUsed: ctx.activeVqdData.browserFallbackUsed,
        delayMs: finalOutcome === 'retrying' ? delayMs : undefined,
        finalOutcome,
        jsdomAttempts: ctx.activeVqdData.jsdomAttempts,
        phase: 'chat_http',
        retryClass: classification.retryClass,
        reusedVqd: ctx.reusedVqd,
        status: chatResponse.status,
        type: classification.info.type,
        overrideCode: classification.info.overrideCode,
      })

      const refreshVqd = shouldRefreshDuckAiVqd(classification.retryClass)

      if (ctx.attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
        await ctx.deps.sleep(delayMs)
        return { kind: 'retry', refreshVqd }
      }

      return { kind: 'error', response: createDuckAiTemporaryUnavailableResponse() }
    }

    return { kind: 'error', response: upstreamErrorResponse('Duck.ai', chatResponse.status, errorText) }
  }

  const primed = await primeDuckAiStream(chatResponse)
  if ('retryableError' in primed) {
    const delayMs = getDuckAiRetryDelay(ctx.attempt, primed.retryableError.info.retryClass)
    const finalOutcome =
      ctx.attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? 'retrying' : 'exhausted'
    logDuckAi('chat', finalOutcome === 'retrying' ? 'warn' : 'error', {
      attempt: ctx.attempt,
      browserFallbackUsed: ctx.activeVqdData.browserFallbackUsed,
      delayMs: finalOutcome === 'retrying' ? delayMs : undefined,
      finalOutcome,
      jsdomAttempts: ctx.activeVqdData.jsdomAttempts,
      phase: 'chat_stream',
      retryClass: primed.retryableError.info.retryClass,
      reusedVqd: ctx.reusedVqd,
      status: primed.retryableError.info.status,
      type: primed.retryableError.info.type,
      overrideCode: primed.retryableError.info.overrideCode,
    })

    const refreshVqd = shouldRefreshDuckAiVqd(primed.retryableError.info.retryClass)

    if (ctx.attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
      await ctx.deps.sleep(delayMs)
      return { kind: 'retry', refreshVqd }
    }

    return { kind: 'error', response: createDuckAiTemporaryUnavailableResponse() }
  }

  if ('errorResponse' in primed) {
    return { kind: 'error', response: primed.errorResponse }
  }

  if (
    ctx.attempt > 1 ||
    ctx.activeVqdData.browserFallbackUsed ||
    ctx.activeVqdData.jsdomAttempts > 1
  ) {
    logDuckAi('chat', 'log', {
      attempt: ctx.attempt,
      browserFallbackUsed: ctx.activeVqdData.browserFallbackUsed,
      finalOutcome: 'success',
      jsdomAttempts: ctx.activeVqdData.jsdomAttempts,
      phase: 'chat_http',
      reusedVqd: ctx.reusedVqd,
    })
  }

  return { kind: 'response', response: primed.response }
}

export function createDuckAiChatHandler(overrides: Partial<DuckAiChatDeps> = {}) {
  const deps: DuckAiChatDeps = {
    buildDuckAiDurableStreamPayload,
    getReasoningEffort,
    getVqdData,
    sendChatRequest: sendDuckAiChatRequest,
    sleep,
    ...overrides,
  }

  return async (messages: ChatMessage[], modelId: string): Promise<Response> => {
    try {
      const ddgMessages = toDdgMessages(messages)
      let reasoningEffort: DuckAiReasoningEffort | undefined

      try {
        reasoningEffort = await deps.getReasoningEffort(modelId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[Duck.ai] Unable to resolve reasoning effort: ${message}`)
      }

      let cookieJar = ''
      let activeVqdData: DuckAiVqdData | null = null

      for (let attempt = 1; attempt <= DUCKAI_CHAT_MAX_ATTEMPTS; attempt++) {
        try {
          const durableStreamPromise = deps.buildDuckAiDurableStreamPayload()
          let durableStream: Awaited<ReturnType<typeof buildDuckAiDurableStreamPayload>>
          let reusedVqd = false

          if (activeVqdData) {
            reusedVqd = true
            durableStream = await durableStreamPromise
          } else {
            const freshVqdDataPromise = deps.getVqdData(cookieJar)
            const [freshVqdData, ds] = await Promise.all([
              freshVqdDataPromise,
              durableStreamPromise,
            ])
            durableStream = ds
            activeVqdData = freshVqdData
            cookieJar = mergeCookies(cookieJar, freshVqdData.cookies)
          }

          const { cookies, response: chatResponse } = await deps.sendChatRequest({
            cookies: cookieJar,
            durableStream,
            messages: ddgMessages,
            modelId,
            reasoningEffort,
            vqdData: activeVqdData,
          })
          cookieJar = mergeCookies(cookieJar, cookies)

          const result = await handleDuckAiChatAttempt(chatResponse, {
            activeVqdData,
            attempt,
            deps,
            reusedVqd,
          })

          if (result.kind === 'response') {
            return result.response
          }

          if (result.kind === 'retry') {
            if (result.refreshVqd) activeVqdData = null
            continue
          }

          return result.response
        } catch (error) {
          const retryable = isRetryableDuckAiThrownError(error)
          if (retryable) {
            const delayMs = getDuckAiRetryDelay(attempt, retryable.info.retryClass)
            const finalOutcome =
              attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? 'retrying' : 'exhausted'
            logDuckAi('chat', finalOutcome === 'retrying' ? 'warn' : 'error', {
              attempt,
              delayMs: finalOutcome === 'retrying' ? delayMs : undefined,
              finalOutcome,
              phase: retryable.info.phase,
              retryClass: retryable.info.retryClass,
              status: retryable.info.status,
              type: retryable.info.type,
              overrideCode: retryable.info.overrideCode,
            })

            if (
              retryable.info.phase === 'vqd' ||
              shouldRefreshDuckAiVqd(retryable.info.retryClass)
            ) {
              activeVqdData = null
            }

            if (attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
              await deps.sleep(delayMs)
              continue
            }

            return createDuckAiTemporaryUnavailableResponse()
          }

          return internalProviderErrorResponse('Duck.ai', error)
        }
      }

      return createDuckAiTemporaryUnavailableResponse()
    } catch (error) {
      return internalProviderErrorResponse('Duck.ai', error)
    }
  }
}

const duckAiChat = createDuckAiChatHandler()

export const duckAiApp = createProviderApp({
  providerId: 'duckai',
  basePath: '/duckai',
  models: DUCKAI_MODELS,
  defaultModel: DUCKAI_MODELS[0].id,
  fetchModels: fetchDuckAiModels,
  chat: duckAiChat,
})

export default duckAiApp.fetch
