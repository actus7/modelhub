import type { ProviderModel } from '@/lib/contracts'

const DEFAULT_MAX_OUTPUT_TOKENS = 4096
const MAX_REQUEST_OUTPUT_TOKENS = 32_000

function clampMaxOutputTokens(value: number): number {
  return Math.max(1, Math.min(MAX_REQUEST_OUTPUT_TOKENS, Math.floor(value)))
}

export function inferMaxOutputTokens(providerId: string, modelId: string): number | undefined {
  const id = `${providerId}/${modelId}`.toLowerCase()

  if (id.includes('gpt-4.1') || id.includes('gpt-4o') || id.includes('gpt-5')) return 16_384
  if (id.includes('o3') || id.includes('o4') || id.includes('reasoner') || id.includes('reasoning')) return 16_384
  if (id.includes('claude-3-5') || id.includes('claude-3.5') || id.includes('claude-sonnet')) return 8_192
  if (id.includes('gemini-2.5') || id.includes('gemini-1.5')) return 8_192
  if (id.includes('llama-3.3') || id.includes('70b') || id.includes('qwen')) return 8_192
  if (id.includes('deepseek')) return 8_192

  return undefined
}

export function resolveMaxOutputTokens(input: {
  model?: Pick<ProviderModel, 'maxOutputTokens'> | null
  modelId?: string
  providerId?: string
}): number {
  if (typeof input.model?.maxOutputTokens === 'number' && Number.isFinite(input.model.maxOutputTokens)) {
    return clampMaxOutputTokens(input.model.maxOutputTokens)
  }

  if (input.providerId && input.modelId) {
    const inferred = inferMaxOutputTokens(input.providerId, input.modelId)
    if (inferred) return clampMaxOutputTokens(inferred)
  }

  return DEFAULT_MAX_OUTPUT_TOKENS
}
