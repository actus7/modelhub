// Claude to OpenAI response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, OPENAI_FINISH } from '../schema/index.js';
import { buildChunk } from '../concerns/chunk.js';
import { toOpenAIUsage } from '../concerns/usage.js';
import { reasoningDelta } from '../concerns/reasoning.js';
import { toOpenAIFinish } from '../concerns/finishReason.js';

function createChunk(state: Record<string, unknown>, delta: Record<string, unknown>, finishReason: string | null = null) {
  return buildChunk({ id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model as string }, delta, finishReason);
}

export function claudeToOpenAIResponse(chunk: Record<string, unknown>, state: Record<string, unknown>): unknown[] | null {
  if (!chunk) return null;
  const results: unknown[] = [];
  const event = chunk.type as string;

  switch (event) {
    case 'message_start': {
      state.messageId = (chunk.message as Record<string, unknown>)?.id || `msg_${Date.now()}`;
      state.model = (chunk.message as Record<string, unknown>)?.model;
      state.toolCallIndex = 0;
      const startUsage = (chunk.message as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
      if (startUsage && typeof startUsage === 'object') {
        const inputTokens = typeof startUsage.input_tokens === 'number' ? startUsage.input_tokens : 0;
        const cacheReadTokens = typeof startUsage.cache_read_input_tokens === 'number' ? startUsage.cache_read_input_tokens : 0;
        const cacheCreationTokens = typeof startUsage.cache_creation_input_tokens === 'number' ? startUsage.cache_creation_input_tokens : 0;
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        state.usage = { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: promptTokens, input_tokens: inputTokens, output_tokens: 0 };
      }
      results.push(createChunk(state, { role: ROLE.ASSISTANT }));
      break;
    }
    case 'content_block_start': {
      const block = chunk.content_block as Record<string, unknown>;
      if (block?.type === CLAUDE_BLOCK.TEXT) state.textBlockStarted = true;
      else if (block?.type === CLAUDE_BLOCK.THINKING) {
        state.inThinkingBlock = true; state.currentBlockIndex = chunk.index;
        results.push(createChunk(state, { content: '<think>' }));
      } else if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
        const toolCallIndex = (state.toolCallIndex as number)++;
        const toolName = (state.toolNameMap as Map<string, string>)?.get(block.name as string) || block.name;
        const toolCall = { index: toolCallIndex, id: block.id, type: OPENAI_BLOCK.FUNCTION, function: { name: toolName, arguments: '' } };
        (state.toolCalls as Map<number, Record<string, unknown>>).set(chunk.index as number, toolCall);
        results.push(createChunk(state, { tool_calls: [toolCall] }));
      }
      break;
    }
    case 'content_block_delta': {
      const delta = chunk.delta as Record<string, unknown>;
      if (delta?.type === 'text_delta' && delta.text) results.push(createChunk(state, { content: delta.text }));
      else if (delta?.type === 'thinking_delta' && delta.thinking) results.push(createChunk(state, reasoningDelta(delta.thinking as string)));
      else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const toolCall = (state.toolCalls as Map<number, Record<string, unknown>>).get(chunk.index as number);
        if (toolCall) {
          (toolCall.function as Record<string, unknown>).arguments = ((toolCall.function as Record<string, unknown>).arguments as string) + (delta.partial_json as string);
          results.push(createChunk(state, { tool_calls: [{ index: toolCall.index, id: toolCall.id, function: { arguments: delta.partial_json } }] }));
        }
      }
      break;
    }
    case 'content_block_stop': {
      if (state.inThinkingBlock && chunk.index === state.currentBlockIndex) {
        results.push(createChunk(state, { content: '</think>' }));
        state.inThinkingBlock = false;
      }
      state.textBlockStarted = false; state.thinkingBlockStarted = false;
      break;
    }
    case 'message_delta': {
      if (chunk.usage && typeof chunk.usage === 'object') {
        const u = chunk.usage as Record<string, unknown>;
        const prev = (state.usage as Record<string, unknown>) || {};
        const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : (prev.input_tokens as number || 0);
        const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
        const cacheReadTokens = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : (prev.cache_read_input_tokens as number || 0);
        const cacheCreationTokens = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : (prev.cache_creation_input_tokens as number || 0);
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        state.usage = { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens, input_tokens: inputTokens, output_tokens: outputTokens };
      }
      if ((chunk.delta as Record<string, unknown>)?.stop_reason) {
        state.finishReason = toOpenAIFinish((chunk.delta as Record<string, unknown>).stop_reason as string, 'claude');
        const finalChunk = createChunk(state, {}, state.finishReason as string);
        if (state.usage) {
          const u = state.usage as Record<string, unknown>;
          (finalChunk as Record<string, unknown>).usage = toOpenAIUsage({ input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens }, 'claude');
        }
        results.push(finalChunk);
        state.finishReasonSent = true;
      }
      break;
    }
    case 'message_stop': {
      if (!state.finishReasonSent) {
        const finishReason = (state.finishReason as string) || ((state.toolCalls as Map<unknown, unknown>)?.size > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP);
        results.push(createChunk(state, {}, finishReason));
        state.finishReasonSent = true;
      }
      break;
    }
  }
  return results.length > 0 ? results : null;
}

register(FORMATS.CLAUDE, FORMATS.OPENAI, null, claudeToOpenAIResponse);
