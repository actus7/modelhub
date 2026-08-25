// Adjust max_tokens based on request context
import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from '../schema/defaults.js';

export function adjustMaxTokens(body: Record<string, unknown>, ceiling = DEFAULT_MAX_TOKENS): number {
  let maxTokens = (body.max_tokens as number) || DEFAULT_MAX_TOKENS;

  if (body.tools && Array.isArray(body.tools) && (body.tools as unknown[]).length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) maxTokens = DEFAULT_MIN_TOKENS;
  }

  const thinking = body.thinking as Record<string, unknown> | undefined;
  if (thinking?.budget_tokens && maxTokens <= (thinking.budget_tokens as number)) {
    maxTokens = (thinking.budget_tokens as number) + 1024;
  }

  if (maxTokens > ceiling) maxTokens = ceiling;
  return maxTokens;
}
