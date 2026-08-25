// Build OpenAI usage object. Caller computes prompt/completion/total (provider math).
export interface UsageInput {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
}

export function buildUsage({
  promptTokens,
  completionTokens,
  totalTokens,
  cachedTokens = 0,
  cacheCreationTokens = 0,
  reasoningTokens = 0,
}: UsageInput): Record<string, unknown> {
  const usage: Record<string, unknown> = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
  if (cachedTokens > 0 || cacheCreationTokens > 0) {
    const details: Record<string, unknown> = {};
    if (cachedTokens > 0) details.cached_tokens = cachedTokens;
    if (cacheCreationTokens > 0) details.cache_creation_tokens = cacheCreationTokens;
    usage.prompt_tokens_details = details;
  }
  if (reasoningTokens > 0) {
    usage.completion_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  return usage;
}

const n = (v: unknown): number => (typeof v === 'number' ? v : 0);

// Per-provider raw token field-map + math. Returns buildUsage() args.
const USAGE_EXTRACTORS: Record<string, (raw: Record<string, unknown>) => UsageInput> = {
  claude(raw) {
    const input = n(raw.input_tokens), output = n(raw.output_tokens);
    const cacheRead = n(raw.cache_read_input_tokens), cacheCreate = n(raw.cache_creation_input_tokens);
    const prompt = input + cacheRead + cacheCreate;
    return { promptTokens: prompt, completionTokens: output, totalTokens: prompt + output, cachedTokens: cacheRead, cacheCreationTokens: cacheCreate };
  },
  gemini(raw) {
    const cached = n(raw.cachedContentTokenCount);
    const prompt = n(raw.promptTokenCount);
    const thoughts = n(raw.thoughtsTokenCount);
    const total = n(raw.totalTokenCount);
    let candidates = n(raw.candidatesTokenCount);
    if (candidates === 0 && total > 0) {
      candidates = total - prompt - thoughts;
      if (candidates < 0) candidates = 0;
    }
    return { promptTokens: prompt, completionTokens: candidates + thoughts, totalTokens: total, cachedTokens: cached, reasoningTokens: thoughts };
  },
  kiro(raw) {
    const input = n(raw.inputTokens), output = n(raw.outputTokens);
    const cached = n(raw.cache_read_input_tokens) || n(raw.cachedTokens) || n(raw.cached_tokens);
    const cacheCreation = n(raw.cache_creation_input_tokens);
    const out: UsageInput = { promptTokens: input, completionTokens: output, totalTokens: input + output };
    if (cached > 0) out.cachedTokens = cached;
    if (cacheCreation > 0) out.cacheCreationTokens = cacheCreation;
    return out;
  },
  ollama(raw) {
    const input = n(raw.prompt_eval_count), output = n(raw.eval_count);
    return { promptTokens: input, completionTokens: output, totalTokens: input + output };
  },
  commandcode(raw) {
    const input = n(raw.inputTokens), output = n(raw.outputTokens);
    const total = typeof raw.totalTokens === 'number' ? raw.totalTokens : input + output;
    return { promptTokens: input, completionTokens: output, totalTokens: total };
  },
};

// Convert provider-native usage object → OpenAI usage. Returns null if no extractor/raw.
export function toOpenAIUsage(raw: Record<string, unknown> | undefined | null, kind: string): Record<string, unknown> | null {
  const extract = USAGE_EXTRACTORS[kind];
  if (!extract || !raw || typeof raw !== 'object') return null;
  return buildUsage(extract(raw));
}
