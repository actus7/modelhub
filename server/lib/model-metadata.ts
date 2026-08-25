// Model metadata — normalization, kinds, name derivation, shared constants.
// Ported from 9router open-sse/providers/schema.js, models/schema.js,
// models/namePatterns.js, models/helpers.js, shared.js

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelKind = 'llm' | 'imageToText' | 'image' | 'stt' | 'tts' | 'embedding'

export interface NormalizedModel {
  id: string
  name: string
  kind: ModelKind
  quotaFamily: string
  strip: string[]
  targetFormat: string | null
  supportedFormats?: string[] | null
  upstreamModelId?: string
}

// ---------------------------------------------------------------------------
// Model ID normalization — digit-digit hyphens → dots
// ---------------------------------------------------------------------------

/**
 * Normalize version separators in a model id: hyphen between two digits becomes a dot.
 * Registry ids use dots for versions ("claude-sonnet-4.5") but clients often send
 * them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are touched.
 */
export function normalizeModelId(modelId: string): string {
  if (typeof modelId !== 'string') return modelId
  return modelId.replace(/(\d)-(\d)/g, '$1.$2')
}

// ---------------------------------------------------------------------------
// Model defaults
// ---------------------------------------------------------------------------

export const MODEL_DEFAULTS = {
  kind: 'llm' as ModelKind,
  quotaFamily: 'normal',
  strip: [] as string[],
  targetFormat: null as string | null,
}

// ---------------------------------------------------------------------------
// Name derivation patterns
// ---------------------------------------------------------------------------

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

type NamePatternEntry = [RegExp, (m: RegExpMatchArray) => string]

const NAME_PATTERNS: NamePatternEntry[] = [
  [/^kimi-k(\d+(?:\.\d+)?)(-thinking)?$/i, (m) => `Kimi K${m[1]}${m[2] ? ' Thinking' : ''}`],
  [/^glm-(\d+(?:\.\d+)?)(v)?$/i, (m) => `GLM ${m[1]}${m[2] ? 'V (Vision)' : ''}`],
  [/^minimax-m(\d+(?:\.\d+)?)$/i, (m) => `MiniMax M${m[1]}`],
  [/^gpt-(.+)$/i, (m) => `GPT ${titleCase(m[1])}`],
  [/^gemini-(.+)$/i, (m) => `Gemini ${titleCase(m[1])}`],
  [/^grok-(.+)$/i, (m) => `Grok ${titleCase(m[1])}`],
  [/^deepseek-(.+)$/i, (m) => `DeepSeek ${titleCase(m[1])}`],
  [/^qwen([\d.]+.*)$/i, (m) => `Qwen ${titleCase(m[1])}`],
]

/**
 * Derive a display name from a model id via regex patterns.
 * Falls back to the raw id when no pattern matches.
 */
export function deriveModelName(id: string): string {
  if (typeof id !== 'string') return id
  for (const [re, fn] of NAME_PATTERNS) {
    const m = id.match(re)
    if (m) return fn(m)
  }
  return id
}

// ---------------------------------------------------------------------------
// Model normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a registry model entry: accept terse "id" string, fill name via regex.
 */
export function normalizeModel(raw: string | Partial<NormalizedModel>): NormalizedModel {
  const model = typeof raw === 'string' ? { id: raw } : raw
  const id = model.id ?? ''
  const name = model.name ?? deriveModelName(id)
  const kind = (model.kind as ModelKind) ?? MODEL_DEFAULTS.kind
  const quotaFamily = model.quotaFamily ?? MODEL_DEFAULTS.quotaFamily
  const strip = model.strip ?? MODEL_DEFAULTS.strip
  const targetFormat = model.targetFormat ?? MODEL_DEFAULTS.targetFormat

  return {
    id,
    name,
    kind,
    quotaFamily,
    strip,
    targetFormat,
    ...(model.supportedFormats !== undefined ? { supportedFormats: model.supportedFormats } : {}),
    ...(model.upstreamModelId !== undefined ? { upstreamModelId: model.upstreamModelId } : {}),
  }
}

// ---------------------------------------------------------------------------
// Model field accessors
// ---------------------------------------------------------------------------

export function modelKind(model: { kind?: string; type?: string } | undefined): ModelKind {
  return (model?.kind ?? model?.type ?? MODEL_DEFAULTS.kind) as ModelKind
}

export function modelQuotaFamily(model: { quotaFamily?: string } | undefined): string {
  return model?.quotaFamily ?? MODEL_DEFAULTS.quotaFamily
}

export function modelStrip(model: { strip?: string[] } | undefined): string[] {
  return model?.strip ?? []
}

export function modelTargetFormat(model: { targetFormat?: string | null } | undefined): string | null {
  return model?.targetFormat ?? MODEL_DEFAULTS.targetFormat
}

export function modelSupportedFormats(model: { supportedFormats?: string[] | null } | undefined): string[] | null {
  return model?.supportedFormats ?? null
}

// ---------------------------------------------------------------------------
// Codex review model helpers
// ---------------------------------------------------------------------------

export const CODEX_REVIEW_SUFFIX = '-review'

export function withCodexReviewModels<T extends { id: string; name: string; kind?: string; type?: string; upstreamModelId?: string; quotaFamily?: string }>(
  models: T[],
): T[] {
  return models.flatMap((model) => {
    if ((model.kind ?? model.type ?? 'llm') !== 'llm' || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model]
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId ?? model.id,
        quotaFamily: 'review',
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Shared provider constants
// ---------------------------------------------------------------------------

/** Anthropic API version (single source) */
export const ANTHROPIC_API_VERSION = '2023-06-01'

/** Shared Claude-compatible API headers */
export const CLAUDE_API_HEADERS: Record<string, string> = {
  'Anthropic-Version': ANTHROPIC_API_VERSION,
  'Anthropic-Beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
}

/** Full Claude CLI fingerprint headers */
export const CLAUDE_CLI_SPOOF_HEADERS: Record<string, string> = {
  'Anthropic-Version': ANTHROPIC_API_VERSION,
  'Anthropic-Beta':
    'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28',
  'Anthropic-Dangerous-Direct-Browser-Access': 'true',
  'User-Agent': 'claude-cli/2.1.92 (external, sdk-cli)',
  'X-App': 'cli',
  'X-Stainless-Helper-Method': 'stream',
  'X-Stainless-Retry-Count': '0',
  'X-Stainless-Runtime-Version': 'v24.14.0',
  'X-Stainless-Package-Version': '0.80.0',
  'X-Stainless-Runtime': 'node',
  'X-Stainless-Lang': 'js',
  'X-Stainless-Arch': 'x64',
  'X-Stainless-Os': 'Linux',
  'X-Stainless-Timeout': '600',
}

const ANTHROPIC_BETA_BASE = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'structured-outputs-2025-12-15',
  'fast-mode-2026-02-01',
  'redact-thinking-2026-02-12',
  'token-efficient-tools-2026-03-28',
]
const ANTHROPIC_BETA_HEAVY_AGENT = ['advanced-tool-use-2025-11-20', 'effort-2025-11-24']

/**
 * Select the appropriate Anthropic beta flags for a model.
 * Heavy-agent flags are gated to opus/sonnet.
 */
export function selectAnthropicBeta(model = ''): string {
  const flags = [...ANTHROPIC_BETA_BASE]
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT)
  return flags.join(',')
}

/** Kimi Coding base URL */
export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding/v1/messages'

/** Default base for dynamic OpenAI-compatible providers */
export const OPENAI_COMPAT_BASE = 'https://api.openai.com/v1'

/** Default base for dynamic Anthropic-compatible providers */
export const ANTHROPIC_COMPAT_BASE = 'https://api.anthropic.com/v1'

/** Antigravity IDE version and base URL */
export const ANTIGRAVITY_IDE_VERSION = '2.1.1'
export const ANTIGRAVITY_IDE_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com'
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`

/**
 * Aggregated shared constants for provider integrations.
 */
export const PROVIDER_SHARED_CONSTANTS = {
  ANTHROPIC_API_VERSION,
  CLAUDE_API_HEADERS,
  CLAUDE_CLI_SPOOF_HEADERS,
  KIMI_CODING_BASE_URL,
  OPENAI_COMPAT_BASE,
  ANTHROPIC_COMPAT_BASE,
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_BASE_URL,
  ANTIGRAVITY_IDE_USER_AGENT,
  selectAnthropicBeta,
}
