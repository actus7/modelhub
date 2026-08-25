// OpenAI to Claude response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from '../schema/index.js';
import { fromOpenAIFinish } from '../concerns/finishReason.js';
import { extractReasoningText } from '../concerns/reasoning.js';

function stopThinkingBlock(state: Record<string, unknown>, results: unknown[]): void {
  if (!state.thinkingBlockStarted) return;
  results.push({ type: 'content_block_stop', index: state.thinkingBlockIndex });
  state.thinkingBlockStarted = false;
}

function stopTextBlock(state: Record<string, unknown>, results: unknown[]): void {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({ type: 'content_block_stop', index: state.textBlockIndex });
  state.textBlockStarted = false;
}

export function openaiToClaudeResponse(chunk: Record<string, unknown>, state: Record<string, unknown>): unknown[] | null {
  if (!chunk || !(chunk.choices as unknown[])?.[0]) return null;
  const results: unknown[] = [];
  const choice = (chunk.choices as Array<Record<string, unknown>>)[0];
  const delta = choice.delta as Record<string, unknown>;

  if (chunk.usage && typeof chunk.usage === 'object') {
    const u = chunk.usage as Record<string, unknown>;
    const promptTokens = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
    const outputTokens = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
    const cachedTokens = (u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens;
    const cacheCreationTokens = (u.prompt_tokens_details as Record<string, unknown>)?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === 'number' ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === 'number' ? cacheCreationTokens : 0;
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;
    state.usage = { input_tokens: inputTokens, output_tokens: outputTokens };
    if (cacheReadTokens > 0) (state.usage as Record<string, unknown>).cache_read_input_tokens = cacheReadTokens;
    if (cacheCreateTokens > 0) (state.usage as Record<string, unknown>).cache_creation_input_tokens = cacheCreateTokens;
  }

  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = (chunk.id as string)?.replace('chatcmpl-', '') || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === 'chat' || (state.messageId as string).length < 8) state.messageId = `msg_${Date.now()}`;
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({ type: 'message_start', message: { id: state.messageId, type: 'message', role: ROLE.ASSISTANT, model: state.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }

  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);
    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = (state.nextBlockIndex as number)++;
      state.thinkingBlockStarted = true;
      results.push({ type: 'content_block_start', index: state.thinkingBlockIndex, content_block: { type: CLAUDE_BLOCK.THINKING, thinking: '' } });
    }
    results.push({ type: 'content_block_delta', index: state.thinkingBlockIndex, delta: { type: 'thinking_delta', thinking: reasoningContent } });
  }

  if (delta?.content) {
    stopThinkingBlock(state, results);
    if (!state.textBlockStarted) {
      state.textBlockIndex = (state.nextBlockIndex as number)++;
      state.textBlockStarted = true; state.textBlockClosed = false;
      results.push({ type: 'content_block_start', index: state.textBlockIndex, content_block: { type: CLAUDE_BLOCK.TEXT, text: '' } });
    }
    results.push({ type: 'content_block_delta', index: state.textBlockIndex, delta: { type: 'text_delta', text: delta.content } });
  }

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
      const idx = (tc.index as number) ?? 0;
      if (tc.id && !(state.toolCalls as Map<number, Record<string, unknown>>).has(idx)) {
        stopThinkingBlock(state, results); stopTextBlock(state, results);
        const toolBlockIndex = (state.nextBlockIndex as number)++;
        (state.toolCalls as Map<number, Record<string, unknown>>).set(idx, { id: tc.id, name: (tc.function as Record<string, unknown>)?.name || '', blockIndex: toolBlockIndex });
        results.push({ type: 'content_block_start', index: toolBlockIndex, content_block: { type: CLAUDE_BLOCK.TOOL_USE, id: tc.id, name: (tc.function as Record<string, unknown>)?.name || '', input: {} } });
      }
      if ((tc.function as Record<string, unknown>)?.arguments) {
        const toolInfo = (state.toolCalls as Map<number, Record<string, unknown>>).get(idx);
        if (toolInfo) {
          if (!state.toolArgBuffers) state.toolArgBuffers = new Map<number, string>();
          (state.toolArgBuffers as Map<number, string>).set(idx, ((state.toolArgBuffers as Map<number, string>).get(idx) || '') + ((tc.function as Record<string, unknown>).arguments as string));
        }
      }
    }
  }

  if (choice.finish_reason) {
    stopThinkingBlock(state, results); stopTextBlock(state, results);
    for (const [idx, toolInfo] of state.toolCalls as Map<number, Record<string, unknown>>) {
      const buffered = (state.toolArgBuffers as Map<number, string>)?.get(idx);
      if (buffered) results.push({ type: 'content_block_delta', index: toolInfo.blockIndex, delta: { type: 'input_json_delta', partial_json: buffered } });
      results.push({ type: 'content_block_stop', index: toolInfo.blockIndex });
    }
    state.finishReason = choice.finish_reason;
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({ type: 'message_delta', delta: { stop_reason: fromOpenAIFinish(choice.finish_reason as string, 'claude') }, usage: finalUsage });
    results.push({ type: 'message_stop' });
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
