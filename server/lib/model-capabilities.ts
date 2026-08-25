// Model capabilities — what each model can read/do beyond plain text.
// Ported from 9router open-sse/providers/capabilities.js
//
// Fallback order (first match wins), result merged over DEFAULT_CAPABILITIES:
//   1. PROVIDER_CAPABILITIES[provider][model]  — provider-specific override
//   2. MODEL_CAPABILITIES[model]               — canonical exact id (handles exceptions)
//   3. PATTERN_CAPABILITIES                     — glob match, ordered specific -> generic
//   4. DEFAULT_CAPABILITIES                     — safe floor (always returned)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThinkingRange {
  min: number
  max: number
}

export type ThinkingFormat =
  | 'openai'
  | 'claude-adaptive'
  | 'claude-budget'
  | 'gemini-level'
  | 'gemini-budget'
  | 'zai'
  | 'qwen'
  | 'deepseek'
  | 'kimi'
  | 'minimax'
  | 'hunyuan'
  | 'step'

export interface ModelCapabilities {
  vision: boolean
  pdf: boolean
  audioInput: boolean
  videoInput: boolean
  imageOutput: boolean
  audioOutput: boolean
  search: boolean
  tools: boolean
  reasoning: boolean
  thinkingFormat: ThinkingFormat | null
  thinkingCanDisable: boolean
  thinkingRange: ThinkingRange | null
  contextWindow: number
  maxOutput: number
}

export type PartialCapabilities = Partial<ModelCapabilities>

// ---------------------------------------------------------------------------
// Safe floor — every resolved result is merged over this
// ---------------------------------------------------------------------------

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: false,
  pdf: false,
  audioInput: false,
  videoInput: false,
  imageOutput: false,
  audioOutput: false,
  search: false,
  tools: true,
  reasoning: false,
  thinkingFormat: null,
  thinkingCanDisable: true,
  thinkingRange: null,
  contextWindow: 200_000,
  maxOutput: 64_000,
}

// ---------------------------------------------------------------------------
// Service kind → capability mapping (for user-added models)
// ---------------------------------------------------------------------------

const SERVICE_KIND_CAPABILITIES: Record<string, PartialCapabilities> = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
}

export function capabilitiesFromServiceKind(
  kind: string,
): PartialCapabilities | null {
  return SERVICE_KIND_CAPABILITIES[kind] ?? null
}

// ---------------------------------------------------------------------------
// Canonical exact-id overrides — only declare deltas vs DEFAULT
// ---------------------------------------------------------------------------

export const MODEL_CAPABILITIES: Record<string, PartialCapabilities> = {
  // Claude Opus 5, 4.6/4.7/4.8, and Kiro Sonnet 5
  'claude-opus-5': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-5-thinking': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-5-agentic': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-5-thinking-agentic': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4.6': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4.7': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4-7': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4.8': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4-6': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4-8': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4.8-thinking': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-opus-4-8-thinking': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-4.6': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-4-6': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-5': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-5-thinking': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-5-agentic': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },
  'claude-sonnet-5-thinking-agentic': {
    vision: true, reasoning: true, search: true,
    thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000,
  },

  // Gemini image-gen / OpenAI image / xai image variants
  'gpt-image-1': { imageOutput: true, tools: false },

  // GLM vision variant
  'glm-4.6v': { vision: true, reasoning: true, thinkingFormat: 'zai', contextWindow: 128_000 },

  // Qwen registry aliases
  'vision-model': { vision: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000 },
  'coder-model': { reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000 },

  // Kimi flagship + coding
  'kimi-k3': {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 131_072,
  },
  k3: {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 131_072,
  },
  'kimi-for-coding': {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536,
  },
  'kimi-for-coding-highspeed': {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536,
  },
  'kimi-k2.7-code': {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536,
  },
  'kimi-k2.7-code-highspeed': {
    vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi',
    thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536,
  },
}

// Shared capability objects for Kiro / Codex GPT-5.6
const KIRO_GPT_5_6_CAPABILITIES: PartialCapabilities = {
  vision: true, reasoning: true, search: true,
  thinkingFormat: 'openai', contextWindow: 272_000, maxOutput: 128_000,
}
const CODEX_GPT_56_SOL_CAPS: PartialCapabilities = {
  vision: true, reasoning: true, search: true,
  thinkingFormat: 'openai', contextWindow: 372_000, maxOutput: 128_000,
}
const CODEX_GPT_56_DEFAULT_CAPS: PartialCapabilities = {
  vision: true, reasoning: true, search: true,
  thinkingFormat: 'openai', contextWindow: 272_000, maxOutput: 128_000,
}

// ---------------------------------------------------------------------------
// Provider-specific capability overrides
// ---------------------------------------------------------------------------

export const PROVIDER_CAPABILITIES: Record<string, Record<string, PartialCapabilities>> = {
  nvidia: {
    'minimaxai/minimax-m2.7': { reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 131_072 },
    'minimaxai/minimax-m3': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 512_000, maxOutput: 131_072 },
    'z-ai/glm-5.2': { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 128_000 },
    'deepseek-ai/deepseek-v4-pro': { reasoning: true, thinkingFormat: 'openai', contextWindow: 1_000_000, maxOutput: 65_536 },
    'deepseek-ai/deepseek-v4-flash': { reasoning: true, thinkingFormat: 'openai', contextWindow: 1_000_000, maxOutput: 65_536 },
  },
  codex: {
    'gpt-5.6-sol': CODEX_GPT_56_SOL_CAPS,
    'gpt-5.6-sol-review': CODEX_GPT_56_SOL_CAPS,
    'gpt-5.6-terra': CODEX_GPT_56_DEFAULT_CAPS,
    'gpt-5.6-terra-review': CODEX_GPT_56_DEFAULT_CAPS,
    'gpt-5.6-luna': CODEX_GPT_56_DEFAULT_CAPS,
    'gpt-5.6-luna-review': CODEX_GPT_56_DEFAULT_CAPS,
  },
  kiro: {
    'gpt-5.6-sol': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-terra': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-luna': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-sol-thinking': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-terra-thinking': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-luna-thinking': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-sol-agentic': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-terra-agentic': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-luna-agentic': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-sol-thinking-agentic': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-terra-thinking-agentic': KIRO_GPT_5_6_CAPABILITIES,
    'gpt-5.6-luna-thinking-agentic': KIRO_GPT_5_6_CAPABILITIES,
  },
  'codebuddy-cn': {
    'glm-5.2': { reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 1_000_000, maxOutput: 48_000 },
    'glm-5.1': { reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 48_000 },
    'glm-5.0': { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 48_000 },
    'glm-5.0-turbo': { reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 48_000 },
    'glm-5v-turbo': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 38_000 },
    'glm-4.7': { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 48_000 },
    'minimax-m3': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 512_000, maxOutput: 48_000 },
    'minimax-m2.7': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 48_000 },
    'kimi-k2.7': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 256_000, maxOutput: 32_000 },
    'kimi-k2.6': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 256_000, maxOutput: 32_000 },
    'kimi-k2.5': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 164_000, maxOutput: 32_000 },
    'hy3-preview': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 192_000, maxOutput: 64_000 },
    'deepseek-v4-pro': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 1_000_000, maxOutput: 50_000 },
    'deepseek-v4-flash': { vision: true, reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 1_000_000, maxOutput: 50_000 },
    'deepseek-v3-2-volc': { reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: false, contextWindow: 96_000, maxOutput: 32_000 },
  },
  poolside: {
    'laguna-s-2.1': { reasoning: true, thinkingFormat: 'openai', contextWindow: 1_000_000, maxOutput: 32_000 },
    'laguna-xs-2.1': { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 32_000 },
  },
}

// ---------------------------------------------------------------------------
// Pattern fallback — glob (* = wildcard), case-insensitive, anchored
// ORDER MATTERS: specific before generic
// ---------------------------------------------------------------------------

interface PatternCapabilityEntry {
  pattern: string
  caps: PartialCapabilities
}

export const PATTERN_CAPABILITIES: PatternCapabilityEntry[] = [
  // ── Claude (4.6+ = adaptive thinking; older/haiku = budget) ──────
  { pattern: '*claude*opus-5*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive', contextWindow: 1_000_000, maxOutput: 128_000 } },
  { pattern: '*claude*opus-4.6*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive' } },
  { pattern: '*claude*opus-4.7*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive' } },
  { pattern: '*claude*opus-4.8*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive' } },
  { pattern: '*claude*sonnet-4.6*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive' } },
  { pattern: '*claude*sonnet-4.7*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-adaptive' } },
  { pattern: '*claude*haiku*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude*opus*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude*sonnet*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },
  { pattern: '*claude*fable*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget', contextWindow: 1_000_000, maxOutput: 128_000 } },
  { pattern: '*claude*mythos*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget', contextWindow: 1_000_000, maxOutput: 128_000 } },
  { pattern: '*claude-3*', caps: { vision: true } },
  { pattern: '*claude*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'claude-budget' } },

  // ── Gemini ───────────────────────────────────────────────────────
  { pattern: '*gemini*image*', caps: { vision: true, imageOutput: true, contextWindow: 1_048_576 } },
  { pattern: '*gemini-3.7*', caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini-3*pro*', caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 65_535 } },
  { pattern: '*gemini-3*', caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini-2.5*', caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: 'gemini-budget', thinkingRange: { min: 0, max: 24_576 }, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini-2*', caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1_048_576, maxOutput: 65_536 } },
  { pattern: '*gemini*', caps: { vision: true, search: true, contextWindow: 1_048_576 } },
  { pattern: '*gemma*', caps: { vision: true, contextWindow: 128_000 } },
  { pattern: '*nanobanana*', caps: { vision: true, imageOutput: true } },

  // ── OpenAI GPT-5.x ──────────────────────────────────────────────
  { pattern: '*gpt-5*image*', caps: { imageOutput: true } },
  { pattern: '*gpt-5*codex*', caps: { reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 400_000, maxOutput: 128_000 } },
  { pattern: '*gpt-5*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 400_000, maxOutput: 128_000 } },
  { pattern: '*gpt-4o*', caps: { vision: true, search: true, contextWindow: 128_000, maxOutput: 16_384 } },
  { pattern: '*gpt-4.1*', caps: { vision: true, contextWindow: 1_000_000, maxOutput: 32_768 } },
  { pattern: '*gpt-4-turbo*', caps: { vision: true, contextWindow: 128_000 } },
  { pattern: '*gpt-4*', caps: { contextWindow: 128_000 } },
  { pattern: '*gpt-3.5*', caps: { contextWindow: 16_385, maxOutput: 4_096 } },
  { pattern: '*gpt-oss*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 128_000 } },

  // ── OpenAI o-series ──────────────────────────────────────────────
  { pattern: '*o1-mini*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 128_000 } },
  { pattern: '*o1*', caps: { vision: true, reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: '*o3*', caps: { vision: true, reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: '*o4*', caps: { vision: true, reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 100_000 } },

  // ── Grok ─────────────────────────────────────────────────────────
  { pattern: '*grok*image*', caps: { imageOutput: true } },
  { pattern: '*grok-code*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 256_000 } },
  { pattern: '*grok-4.5*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 500_000, maxOutput: 64_000 } },
  { pattern: '*grok-4*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 256_000 } },
  { pattern: '*grok-3*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 131_072 } },
  { pattern: '*grok*', caps: { vision: true, reasoning: true, search: true, thinkingFormat: 'openai', contextWindow: 256_000 } },

  // ── Qwen ─────────────────────────────────────────────────────────
  { pattern: '*qwen*vl*', caps: { vision: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 262_144 } },
  { pattern: '*qwen*omni*', caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 262_144, maxOutput: 65_536 } },
  { pattern: '*qwen*coder*', caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000 } },
  { pattern: '*qwen*max*', caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: '*qwen3.5*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: '*qwen3.6*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: '*qwen3.7*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: '*qwen*plus*', caps: { vision: true, reasoning: true, thinkingFormat: 'qwen', contextWindow: 1_000_000, maxOutput: 65_536 } },
  { pattern: '*qwen*235b*', caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 262_144 } },
  { pattern: '*qwq*', caps: { reasoning: true, thinkingFormat: 'qwen', thinkingCanDisable: false, contextWindow: 131_072 } },
  { pattern: '*qwen*', caps: { reasoning: true, thinkingFormat: 'qwen', contextWindow: 262_144 } },

  // ── Kimi ─────────────────────────────────────────────────────────
  { pattern: '*kimi*k3*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi', thinkingCanDisable: false, contextWindow: 1_048_576, maxOutput: 131_072 } },
  { pattern: '*kimi*for-coding*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi', thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536 } },
  { pattern: '*kimi*k2.7*code*', caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: 'kimi', thinkingCanDisable: false, contextWindow: 262_144, maxOutput: 65_536 } },
  { pattern: '*kimi*k2*', caps: { vision: true, reasoning: true, thinkingFormat: 'kimi', contextWindow: 262_144, maxOutput: 262_144 } },
  { pattern: '*kimi*', caps: { reasoning: true, thinkingFormat: 'kimi', contextWindow: 262_144 } },

  // ── GLM / Z.ai ───────────────────────────────────────────────────
  { pattern: '*glm-5*', caps: { reasoning: true, thinkingFormat: 'zai', contextWindow: 200_000, maxOutput: 128_000 } },
  { pattern: '*glm-4.7*', caps: { reasoning: true, thinkingFormat: 'zai', contextWindow: 200_000, maxOutput: 128_000 } },
  { pattern: '*glm-4*', caps: { reasoning: true, thinkingFormat: 'zai', contextWindow: 200_000 } },
  { pattern: '*glm*', caps: { reasoning: true, thinkingFormat: 'zai', contextWindow: 200_000 } },

  // ── DeepSeek ─────────────────────────────────────────────────────
  { pattern: '*deepseek-v4*', caps: { reasoning: true, thinkingFormat: 'deepseek', contextWindow: 1_000_000, maxOutput: 384_000 } },
  { pattern: '*reasoner*', caps: { reasoning: true, thinkingFormat: 'deepseek', thinkingCanDisable: false, contextWindow: 128_000 } },
  { pattern: '*deepseek-r*', caps: { reasoning: true, thinkingFormat: 'deepseek', thinkingCanDisable: false, contextWindow: 128_000 } },
  { pattern: '*deepseek-chat*', caps: { contextWindow: 128_000 } },
  { pattern: '*deepseek*', caps: { reasoning: true, thinkingFormat: 'deepseek', contextWindow: 128_000 } },

  // ── MiniMax ──────────────────────────────────────────────────────
  { pattern: '*minimax*image*', caps: { imageOutput: true } },
  { pattern: '*minimax-m3*', caps: { vision: true, reasoning: true, thinkingFormat: 'minimax', contextWindow: 1_048_576, maxOutput: 512_000 } },
  { pattern: '*minimax-m2.7*', caps: { reasoning: true, thinkingFormat: 'minimax', thinkingCanDisable: false, contextWindow: 204_800, maxOutput: 131_072 } },
  { pattern: '*minimax*', caps: { reasoning: true, thinkingFormat: 'minimax', thinkingCanDisable: false, contextWindow: 200_000, maxOutput: 131_072 } },

  // ── Xiaomi MiMo ──────────────────────────────────────────────────
  { pattern: '*mimo*v2.5*', caps: { vision: true, audioInput: true, videoInput: true, contextWindow: 1_048_576, maxOutput: 131_072 } },
  { pattern: '*mimo*omni*', caps: { vision: true, audioInput: true, contextWindow: 262_144, maxOutput: 131_072 } },
  { pattern: '*mimo*', caps: { vision: true, contextWindow: 262_144, maxOutput: 131_072 } },

  // ── Llama ────────────────────────────────────────────────────────
  { pattern: '*llama-4*', caps: { vision: true, contextWindow: 1_000_000 } },
  { pattern: '*llama*', caps: { contextWindow: 128_000 } },

  // ── Mistral ──────────────────────────────────────────────────────
  { pattern: '*codestral*', caps: { contextWindow: 256_000 } },
  { pattern: '*mistral-large*', caps: { vision: true, contextWindow: 256_000 } },
  { pattern: '*mistral*', caps: { contextWindow: 128_000 } },

  // ── Cohere ───────────────────────────────────────────────────────
  { pattern: '*command-a-vision*', caps: { vision: true, contextWindow: 128_000 } },
  { pattern: '*command*', caps: { contextWindow: 128_000 } },

  // ── Perplexity ───────────────────────────────────────────────────
  { pattern: '*sonar*', caps: { search: true, contextWindow: 128_000 } },
  { pattern: '*pplx*', caps: { search: true, contextWindow: 128_000 } },
  { pattern: '*perplexity*', caps: { search: true, contextWindow: 128_000 } },

  // ── Poolside Laguna ──────────────────────────────────────────────
  { pattern: '*laguna-s-2.1*free*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 32_000 } },
  { pattern: '*laguna-s-2.1*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 1_000_000, maxOutput: 32_000 } },
  { pattern: '*laguna*', caps: { reasoning: true, thinkingFormat: 'openai', contextWindow: 200_000, maxOutput: 32_000 } },

  // ── Others ───────────────────────────────────────────────────────
  { pattern: '*hunyuan*', caps: { reasoning: true, thinkingFormat: 'hunyuan', contextWindow: 262_144, maxOutput: 262_144 } },
  { pattern: 'hy3*', caps: { reasoning: true, thinkingFormat: 'hunyuan', contextWindow: 262_144, maxOutput: 262_144 } },
  { pattern: '*step-*', caps: { reasoning: true, thinkingFormat: 'step', contextWindow: 128_000 } },
  { pattern: '*nemotron*', caps: { reasoning: true, contextWindow: 128_000 } },
  { pattern: '*ling-*', caps: { reasoning: true, contextWindow: 128_000 } },
]

// ---------------------------------------------------------------------------
// Glob pattern matcher (* = any substring, case-insensitive, anchored)
// ---------------------------------------------------------------------------

export function matchPattern(pattern: string, model: string): boolean {
  const escaped = pattern
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return regex.test(model)
}

// ---------------------------------------------------------------------------
// Resolve capabilities — 4-step fallback chain
// ---------------------------------------------------------------------------

export function resolveCapabilities(
  modelId: string,
  providerId?: string,
): ModelCapabilities {
  if (!modelId) return { ...DEFAULT_CAPABILITIES }

  // Strip vendor prefix: "anthropic/claude-opus-4.7" -> "claude-opus-4.7"
  const baseModel = modelId.includes('/') ? modelId.split('/').pop()! : modelId

  // 1. Provider-specific override
  if (providerId) {
    const providerCaps = PROVIDER_CAPABILITIES[providerId]
    if (providerCaps?.[modelId]) return { ...DEFAULT_CAPABILITIES, ...providerCaps[modelId] }
    if (providerCaps?.[baseModel]) return { ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] }
  }

  // 2. Canonical exact
  if (MODEL_CAPABILITIES[baseModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] }
  if (MODEL_CAPABILITIES[modelId]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[modelId] }

  // 3. Pattern match (first match wins)
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, modelId)) {
      return { ...DEFAULT_CAPABILITIES, ...caps }
    }
  }

  // 4. Floor
  return { ...DEFAULT_CAPABILITIES }
}

// ---------------------------------------------------------------------------
// Thinking levels configuration
// ---------------------------------------------------------------------------

const LEVEL_SETS = {
  base: ['none', 'low', 'medium', 'high'],
  onOff: ['none', 'thinking'],
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  levelMax: ['none', 'low', 'medium', 'high', 'max'],
  budgetX: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  gemini: ['minimal', 'low', 'medium', 'high'],
  hiMax: ['none', 'high', 'max'],
} as const

const FORMAT_LEVELS: Record<string, readonly string[]> = {
  openai: LEVEL_SETS.openai,
  'claude-adaptive': LEVEL_SETS.levelMax,
  'claude-budget': LEVEL_SETS.budgetX,
  'gemini-level': LEVEL_SETS.gemini,
  'gemini-budget': LEVEL_SETS.base,
  zai: LEVEL_SETS.onOff,
  qwen: LEVEL_SETS.base,
  kimi: LEVEL_SETS.levelMax,
  deepseek: LEVEL_SETS.hiMax,
  minimax: LEVEL_SETS.onOff,
  hunyuan: LEVEL_SETS.base,
  step: LEVEL_SETS.base,
}

interface PatternThinkingEntry {
  provider?: string
  pattern: string
  levels: string[]
}

const CODEX_GPT_5_6_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const PATTERN_THINKING: PatternThinkingEntry[] = [
  { provider: 'codex', pattern: '*gpt-5.6-sol*', levels: [...CODEX_GPT_5_6_LEVELS, 'ultra'] },
  { provider: 'codex', pattern: '*gpt-5.6-terra*', levels: [...CODEX_GPT_5_6_LEVELS, 'ultra'] },
  { provider: 'codex', pattern: '*gpt-5.6-luna*', levels: CODEX_GPT_5_6_LEVELS },
  { pattern: '*codex*', levels: ['low', 'medium', 'high', 'xhigh'] },
]

export interface ThinkingConfig {
  levels: string[]
  format: ThinkingFormat
  canDisable: boolean
  range: ThinkingRange | null
}

/**
 * Returns thinking configuration for a model, or null when the model has no reasoning.
 */
export function getThinkingConfig(
  providerId: string | undefined,
  modelId: string,
): ThinkingConfig | null {
  const caps = resolveCapabilities(modelId, providerId)
  if (!caps.reasoning || !caps.thinkingFormat) return null

  const hit = PATTERN_THINKING.find(
    (entry) =>
      (!entry.provider || entry.provider === providerId) &&
      matchPattern(entry.pattern, modelId),
  )

  let levels: string[] = [...(hit?.levels ?? FORMAT_LEVELS[caps.thinkingFormat] ?? LEVEL_SETS.base)]
  if (caps.thinkingCanDisable === false) {
    levels = levels.filter((l) => l !== 'none')
  }

  return {
    levels,
    format: caps.thinkingFormat,
    canDisable: caps.thinkingCanDisable,
    range: caps.thinkingRange,
  }
}
