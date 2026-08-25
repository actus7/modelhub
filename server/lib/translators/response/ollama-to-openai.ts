// Ollama to OpenAI response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from '../schema/index.js';
import { buildChunk } from '../concerns/chunk.js';
import { toOpenAIUsage } from '../concerns/usage.js';
import { fallbackToolCallId } from '../concerns/toolCall.js';
import { toOpenAIFinish } from '../concerns/finishReason.js';

export function ollamaToOpenAIResponse(chunk: Record<string, unknown>, state: Record<string, unknown>): unknown | null {
  if (!chunk || typeof chunk !== 'object') return null;

  if (!state.ollama) {
    state.ollama = { id: `chatcmpl-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: chunk.model || state.model };
  }
  const { id, created, model } = state.ollama as Record<string, unknown>;

  if (chunk.done) {
    const usage = toOpenAIUsage(chunk, 'ollama');
    let finishReason = toOpenAIFinish(chunk.done_reason as string, 'ollama');
    if (chunk.done_reason === OPENAI_FINISH.TOOL_CALLS || state.hadToolCalls) finishReason = OPENAI_FINISH.TOOL_CALLS;
    const doneChunk = buildChunk({ id: id as string, created: created as number, model: model as string }, {}, finishReason);
    if (usage) (doneChunk as Record<string, unknown>).usage = usage;
    return doneChunk;
  }

  const message = chunk.message as Record<string, unknown> | undefined;
  if (!message) return null;
  const content = typeof message.content === 'string' ? message.content : '';
  const thinking = typeof message.thinking === 'string' ? message.thinking : '';
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;
  if (!content && !thinking && !toolCalls) return null;

  const delta: Record<string, unknown> = {};
  if (content) delta.content = content;
  if (thinking) delta.reasoning_content = thinking;
  if (toolCalls) {
    state.hadToolCalls = true;
    delta.tool_calls = (toolCalls as Array<Record<string, unknown>>).map((tc, i) => ({
      index: (tc.function as Record<string, unknown>)?.index ?? i,
      id: tc.id || fallbackToolCallId(i),
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: (tc.function as Record<string, unknown>)?.name || '',
        arguments: typeof (tc.function as Record<string, unknown>)?.arguments === 'string'
          ? (tc.function as Record<string, unknown>).arguments
          : JSON.stringify((tc.function as Record<string, unknown>)?.arguments || {}),
      },
    }));
  }

  return buildChunk({ id: id as string, created: created as number, model: model as string }, delta, null);
}

register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAIResponse);
