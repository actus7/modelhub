import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPABILITIES,
  MODEL_CAPABILITIES,
  PATTERN_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  capabilitiesFromServiceKind,
  getThinkingConfig,
  matchPattern,
  resolveCapabilities,
} from './model-capabilities'
import {
  MODEL_PRICING,
  PATTERN_PRICING,
  PROVIDER_PRICING,
  calculateCostFromTokens,
  formatCost,
  getPricing,
} from './model-pricing'
import {
  CODEX_REVIEW_SUFFIX,
  CLAUDE_API_HEADERS,
  CLAUDE_CLI_SPOOF_HEADERS,
  PROVIDER_SHARED_CONSTANTS,
  deriveModelName,
  modelKind,
  modelQuotaFamily,
  modelStrip,
  modelTargetFormat,
  normalizeModel,
  normalizeModelId,
  withCodexReviewModels,
} from './model-metadata'

// ===========================================================================
// matchPattern
// ===========================================================================

describe('matchPattern', () => {
  it('matches exact strings', () => {
    expect(matchPattern('gpt-4o', 'gpt-4o')).toBe(true)
  })

  it('matches wildcard at end', () => {
    expect(matchPattern('gpt-5*', 'gpt-5-mini')).toBe(true)
    expect(matchPattern('gpt-5*', 'gpt-5')).toBe(true)
  })

  it('matches wildcard at start', () => {
    expect(matchPattern('*claude', 'anthropic/claude')).toBe(true)
  })

  it('matches wildcard in middle', () => {
    expect(matchPattern('*claude*opus*', 'claude-opus-4.5')).toBe(true)
    expect(matchPattern('*claude*opus*', 'anthropic-claude-opus-5')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchPattern('MiniMax-*', 'minimax-m3')).toBe(true)
    expect(matchPattern('minimax-*', 'MiniMax-M3')).toBe(true)
  })

  it('does not match partial strings (anchored)', () => {
    expect(matchPattern('gpt-4', 'gpt-4o')).toBe(false)
    expect(matchPattern('gpt-4*', 'gpt-4o')).toBe(true)
  })

  it('handles multiple wildcards', () => {
    expect(matchPattern('*gemini*image*', 'gemini-2.5-flash-image')).toBe(true)
    expect(matchPattern('*gemini*image*', 'gemini-3-pro')).toBe(false)
  })
})

// ===========================================================================
// resolveCapabilities
// ===========================================================================

describe('resolveCapabilities', () => {
  it('returns defaults for empty model', () => {
    const caps = resolveCapabilities('')
    expect(caps).toEqual(DEFAULT_CAPABILITIES)
  })

  it('resolves known Claude model via exact match', () => {
    const caps = resolveCapabilities('claude-opus-5')
    expect(caps.vision).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.search).toBe(true)
    expect(caps.thinkingFormat).toBe('claude-adaptive')
    expect(caps.contextWindow).toBe(1_000_000)
    expect(caps.maxOutput).toBe(128_000)
  })

  it('resolves Claude model via pattern match', () => {
    const caps = resolveCapabilities('claude-sonnet-4-20250514')
    expect(caps.vision).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingFormat).toBe('claude-budget')
  })

  it('resolves GPT-5 model via pattern', () => {
    const caps = resolveCapabilities('gpt-5-mini')
    expect(caps.vision).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingFormat).toBe('openai')
    expect(caps.contextWindow).toBe(400_000)
  })

  it('resolves Gemini model with multimodal capabilities', () => {
    const caps = resolveCapabilities('gemini-2.5-flash')
    expect(caps.vision).toBe(true)
    expect(caps.audioInput).toBe(true)
    expect(caps.videoInput).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.search).toBe(true)
    expect(caps.thinkingFormat).toBe('gemini-budget')
  })

  it('resolves provider-specific override', () => {
    const caps = resolveCapabilities('minimaxai/minimax-m2.7', 'nvidia')
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingFormat).toBe('openai')
    expect(caps.thinkingCanDisable).toBe(false)
  })

  it('strips vendor prefix for canonical lookup', () => {
    const caps = resolveCapabilities('anthropic/claude-opus-5')
    expect(caps.vision).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingFormat).toBe('claude-adaptive')
  })

  it('returns defaults for completely unknown model', () => {
    const caps = resolveCapabilities('totally-unknown-model-xyz')
    expect(caps).toEqual(DEFAULT_CAPABILITIES)
  })

  it('resolves DeepSeek model', () => {
    const caps = resolveCapabilities('deepseek-v4-pro')
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingFormat).toBe('deepseek')
    expect(caps.contextWindow).toBe(1_000_000)
  })

  it('resolves Grok model with search', () => {
    const caps = resolveCapabilities('grok-4')
    expect(caps.vision).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.search).toBe(true)
    expect(caps.thinkingFormat).toBe('openai')
  })

  it('resolves Perplexity model with search', () => {
    const caps = resolveCapabilities('sonar-pro')
    expect(caps.search).toBe(true)
    expect(caps.contextWindow).toBe(128_000)
  })

  it('resolves Kimi model with thinkingCanDisable false', () => {
    const caps = resolveCapabilities('kimi-k3')
    expect(caps.vision).toBe(true)
    expect(caps.videoInput).toBe(true)
    expect(caps.reasoning).toBe(true)
    expect(caps.thinkingCanDisable).toBe(false)
  })

  it('resolves MiMo model with multimodal', () => {
    const caps = resolveCapabilities('mimo-v2.5-pro')
    expect(caps.vision).toBe(true)
    expect(caps.audioInput).toBe(true)
    expect(caps.videoInput).toBe(true)
    expect(caps.contextWindow).toBe(1_048_576)
  })
})

// ===========================================================================
// capabilitiesFromServiceKind
// ===========================================================================

describe('capabilitiesFromServiceKind', () => {
  it('returns vision for imageToText', () => {
    expect(capabilitiesFromServiceKind('imageToText')).toEqual({ vision: true })
  })

  it('returns imageOutput for image', () => {
    expect(capabilitiesFromServiceKind('image')).toEqual({ imageOutput: true })
  })

  it('returns null for unknown kind', () => {
    expect(capabilitiesFromServiceKind('unknown')).toBeNull()
  })
})

// ===========================================================================
// getThinkingConfig
// ===========================================================================

describe('getThinkingConfig', () => {
  it('returns null for non-reasoning model', () => {
    expect(getThinkingConfig(undefined, 'gpt-3.5-turbo')).toBeNull()
  })

  it('returns config for Claude adaptive model', () => {
    const config = getThinkingConfig(undefined, 'claude-opus-5')
    expect(config).not.toBeNull()
    expect(config!.format).toBe('claude-adaptive')
    expect(config!.levels).toContain('none')
    expect(config!.levels).toContain('max')
    expect(config!.canDisable).toBe(true)
  })

  it('filters "none" when thinkingCanDisable is false', () => {
    const config = getThinkingConfig(undefined, 'kimi-k3')
    expect(config).not.toBeNull()
    expect(config!.levels).not.toContain('none')
  })

  it('returns openai format levels for GPT-5', () => {
    const config = getThinkingConfig(undefined, 'gpt-5')
    expect(config).not.toBeNull()
    expect(config!.format).toBe('openai')
    expect(config!.levels).toContain('xhigh')
  })
})

// ===========================================================================
// getPricing (9router system)
// ===========================================================================

describe('getPricing', () => {
  it('returns pricing for known canonical model', () => {
    const price = getPricing('gpt-4o')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(2.5)
    expect(price!.output).toBe(10)
  })

  it('returns pricing for Claude model', () => {
    const price = getPricing('claude-sonnet-4.6')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(3)
    expect(price!.output).toBe(15)
  })

  it('returns provider-specific override', () => {
    const price = getPricing('gpt-5.3-codex', 'gh')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(1.75)
  })

  it('strips vendor prefix for lookup', () => {
    const price = getPricing('deepseek/deepseek-chat')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(0.14)
  })

  it('falls back to pattern pricing', () => {
    const price = getPricing('gpt-5-turbo-preview')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(1.25)
  })

  it('returns null for completely unknown model', () => {
    const price = getPricing('totally-fake-model-xyz')
    expect(price).toBeNull()
  })

  it('returns pricing for Gemini model', () => {
    const price = getPricing('gemini-2.5-pro')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(2)
    expect(price!.output).toBe(12)
  })

  it('returns pricing for DeepSeek model', () => {
    const price = getPricing('deepseek-v4-pro')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(0.435)
  })

  it('pattern pricing for unknown codex variant', () => {
    const price = getPricing('gpt-5-codex-xhigh')
    expect(price).not.toBeNull()
    expect(price!.input).toBe(10)
    expect(price!.output).toBe(40)
  })
})

// ===========================================================================
// calculateCostFromTokens
// ===========================================================================

describe('calculateCostFromTokens', () => {
  it('calculates basic input/output cost', () => {
    const pricing = { input: 1.0, output: 2.0 }
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      pricing,
    )
    expect(cost).toBe(3.0)
  })

  it('handles cached tokens at reduced rate', () => {
    const pricing = { input: 1.0, output: 2.0, cached: 0.1 }
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1_000_000, cached_tokens: 500_000, completion_tokens: 0 },
      pricing,
    )
    // 500K non-cached at $1/M = $0.50, 500K cached at $0.1/M = $0.05
    expect(cost).toBeCloseTo(0.55, 10)
  })

  it('handles reasoning tokens', () => {
    const pricing = { input: 1.0, output: 2.0, reasoning: 5.0 }
    const cost = calculateCostFromTokens(
      { prompt_tokens: 0, completion_tokens: 100_000, reasoning_tokens: 100_000 },
      pricing,
    )
    // 100K output at $2/M = $0.20, 100K reasoning at $5/M = $0.50
    expect(cost).toBeCloseTo(0.7, 10)
  })

  it('returns 0 for empty tokens', () => {
    const cost = calculateCostFromTokens({}, { input: 1.0, output: 2.0 })
    expect(cost).toBe(0)
  })
})

// ===========================================================================
// formatCost
// ===========================================================================

describe('formatCost', () => {
  it('formats cost with 2 decimal places', () => {
    expect(formatCost(1.5)).toBe('$1.50')
  })

  it('returns $0.00 for null', () => {
    expect(formatCost(null)).toBe('$0.00')
  })

  it('returns $0.00 for NaN', () => {
    expect(formatCost(NaN)).toBe('$0.00')
  })

  it('returns $0.00 for undefined', () => {
    expect(formatCost(undefined)).toBe('$0.00')
  })
})

// ===========================================================================
// normalizeModelId
// ===========================================================================

describe('normalizeModelId', () => {
  it('converts digit-digit hyphens to dots', () => {
    expect(normalizeModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(normalizeModelId('gpt-5-1')).toBe('gpt-5.1')
  })

  it('preserves non-digit hyphens', () => {
    expect(normalizeModelId('claude-sonnet-4-thinking')).toBe('claude-sonnet-4-thinking')
    expect(normalizeModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it('handles multiple digit-digit hyphens', () => {
    expect(normalizeModelId('model-3-5-turbo-2-1')).toBe('model-3.5-turbo-2.1')
  })

  it('returns non-strings as-is', () => {
    expect(normalizeModelId(undefined as unknown as string)).toBeUndefined()
  })
})

// ===========================================================================
// normalizeModel
// ===========================================================================

describe('normalizeModel', () => {
  it('normalizes string id', () => {
    const model = normalizeModel('gpt-4o')
    expect(model.id).toBe('gpt-4o')
    expect(model.name).toBe('GPT 4o')
    expect(model.kind).toBe('llm')
    expect(model.quotaFamily).toBe('normal')
  })

  it('normalizes object with id only', () => {
    const model = normalizeModel({ id: 'gpt-5-codex' })
    expect(model.id).toBe('gpt-5-codex')
    expect(model.name).toBe('GPT 5 Codex')
  })

  it('preserves explicit name', () => {
    const model = normalizeModel({ id: 'custom-model', name: 'My Custom Model' })
    expect(model.name).toBe('My Custom Model')
  })

  it('preserves kind and quotaFamily', () => {
    const model = normalizeModel({ id: 'img-model', kind: 'image', quotaFamily: 'premium' })
    expect(model.kind).toBe('image')
    expect(model.quotaFamily).toBe('premium')
  })
})

// ===========================================================================
// deriveModelName
// ===========================================================================

describe('deriveModelName', () => {
  it('derives GPT names', () => {
    expect(deriveModelName('gpt-4o-mini')).toBe('GPT 4o Mini')
    expect(deriveModelName('gpt-5-codex')).toBe('GPT 5 Codex')
  })

  it('derives Claude names (no pattern → raw id)', () => {
    // No claude pattern in NAME_PATTERNS — returns raw id
    expect(deriveModelName('claude-sonnet-4.5')).toBe('claude-sonnet-4.5')
  })

  it('derives Gemini names', () => {
    expect(deriveModelName('gemini-2.5-flash')).toBe('Gemini 2.5 Flash')
  })

  it('derives Kimi names', () => {
    expect(deriveModelName('kimi-k3')).toBe('Kimi K3')
    expect(deriveModelName('kimi-k2.5-thinking')).toBe('Kimi K2.5 Thinking')
  })

  it('derives GLM names', () => {
    expect(deriveModelName('glm-4.6v')).toBe('GLM 4.6V (Vision)')
  })

  it('derives MiniMax names', () => {
    expect(deriveModelName('minimax-m3')).toBe('MiniMax M3')
  })

  it('returns raw id for unknown patterns', () => {
    expect(deriveModelName('some-unknown-model')).toBe('some-unknown-model')
  })
})

// ===========================================================================
// modelKind / modelQuotaFamily / modelStrip / modelTargetFormat
// ===========================================================================

describe('model field accessors', () => {
  it('modelKind returns kind or default', () => {
    expect(modelKind({ kind: 'image' })).toBe('image')
    expect(modelKind({ type: 'stt' })).toBe('stt')
    expect(modelKind(undefined)).toBe('llm')
    expect(modelKind({})).toBe('llm')
  })

  it('modelQuotaFamily returns quotaFamily or default', () => {
    expect(modelQuotaFamily({ quotaFamily: 'premium' })).toBe('premium')
    expect(modelQuotaFamily(undefined)).toBe('normal')
  })

  it('modelStrip returns strip or empty', () => {
    expect(modelStrip({ strip: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(modelStrip(undefined)).toEqual([])
  })

  it('modelTargetFormat returns targetFormat or null', () => {
    expect(modelTargetFormat({ targetFormat: 'openai' })).toBe('openai')
    expect(modelTargetFormat(undefined)).toBeNull()
  })
})

// ===========================================================================
// withCodexReviewModels
// ===========================================================================

describe('withCodexReviewModels', () => {
  it('adds review variant for llm models', () => {
    const models = [{ id: 'gpt-5', name: 'GPT 5' }]
    const result = withCodexReviewModels(models)
    expect(result).toHaveLength(2)
    expect(result[1]!.id).toBe('gpt-5-review')
    expect(result[1]!.name).toBe('GPT 5 Review')
    expect((result[1] as Record<string, unknown>).quotaFamily).toBe('review')
  })

  it('does not add review for non-llm models', () => {
    const models = [{ id: 'img-model', name: 'Img', kind: 'image' }]
    const result = withCodexReviewModels(models)
    expect(result).toHaveLength(1)
  })

  it('does not add review for already-suffixed models', () => {
    const models = [{ id: `gpt-5${CODEX_REVIEW_SUFFIX}`, name: 'GPT 5 Review' }]
    const result = withCodexReviewModels(models)
    expect(result).toHaveLength(1)
  })
})

// ===========================================================================
// Shared constants
// ===========================================================================

describe('PROVIDER_SHARED_CONSTANTS', () => {
  it('exports Claude API headers', () => {
    expect(CLAUDE_API_HEADERS['Anthropic-Version']).toBe('2023-06-01')
    expect(CLAUDE_API_HEADERS['Anthropic-Beta']).toContain('interleaved-thinking')
  })

  it('exports Claude CLI spoof headers', () => {
    expect(CLAUDE_CLI_SPOOF_HEADERS['User-Agent']).toContain('claude-cli')
    expect(CLAUDE_CLI_SPOOF_HEADERS['X-App']).toBe('cli')
  })

  it('exports all expected keys in PROVIDER_SHARED_CONSTANTS', () => {
    expect(PROVIDER_SHARED_CONSTANTS.ANTHROPIC_API_VERSION).toBe('2023-06-01')
    expect(PROVIDER_SHARED_CONSTANTS.KIMI_CODING_BASE_URL).toContain('kimi.com')
    expect(PROVIDER_SHARED_CONSTANTS.OPENAI_COMPAT_BASE).toContain('openai.com')
    expect(PROVIDER_SHARED_CONSTANTS.ANTHROPIC_COMPAT_BASE).toContain('anthropic.com')
    expect(typeof PROVIDER_SHARED_CONSTANTS.selectAnthropicBeta).toBe('function')
  })
})

// ===========================================================================
// Data integrity checks
// ===========================================================================

describe('data integrity', () => {
  it('MODEL_CAPABILITIES has entries', () => {
    expect(Object.keys(MODEL_CAPABILITIES).length).toBeGreaterThan(10)
  })

  it('PATTERN_CAPABILITIES has entries', () => {
    expect(PATTERN_CAPABILITIES.length).toBeGreaterThan(50)
  })

  it('PROVIDER_CAPABILITIES has multiple providers', () => {
    expect(Object.keys(PROVIDER_CAPABILITIES).length).toBeGreaterThanOrEqual(5)
  })

  it('MODEL_PRICING has entries', () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(50)
  })

  it('PATTERN_PRICING has entries', () => {
    expect(PATTERN_PRICING.length).toBeGreaterThan(30)
  })

  it('PROVIDER_PRICING has multiple providers', () => {
    expect(Object.keys(PROVIDER_PRICING).length).toBeGreaterThanOrEqual(2)
  })

  it('all PATTERN_CAPABILITIES patterns are valid regex', () => {
    for (const { pattern } of PATTERN_CAPABILITIES) {
      expect(() => matchPattern(pattern, 'test')).not.toThrow()
    }
  })

  it('all PATTERN_PRICING patterns are valid regex', () => {
    for (const { pattern } of PATTERN_PRICING) {
      expect(() => matchPattern(pattern, 'test')).not.toThrow()
    }
  })
})
