// Kiro to Claude response translator (direct route)
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';

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

function convertFinishReason(reason: string): string {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    default: return 'end_turn';
  }
}

export function kiroToClaudeResponse(chunk: unknown, state: Record<string, unknown>): unknown[] | null {
  let data: Record<string, unknown> = chunk as Record<string, unknown>;
  if (typeof chunk === 'string') {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === '[DONE]') return null;
    try { data = JSON.parse(trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed); } catch { return null; }
  }
  if (!data || !(data.choices as unknown[])?.[0]) return null;

  const results: unknown[] = [];
  const choice = (data.choices as Array<Record<string, unknown>>)[0];
  const delta = (choice.delta || {}) as Record<string, unknown>;

  if (data.usage && typeof data.usage === 'object') {
    const u = data.usage as Record<string, unknown>;
    state.usage = { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 };
  }

  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = (typeof data.id === 'string' && data.id.replace('chatcmpl-', '')) || `msg_${Date.now()}`;
    state.model = data.model || 'kiro';
    state.nextBlockIndex = 0;
    results.push({ type: 'message_start', message: { id: state.messageId, type: 'message', role: 'assistant', model: state.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }

  const reasoningContent = delta.reasoning_content || delta.reasoning;
  if (reasoningContent) {
    stopTextBlock(state, results);
    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = (state.nextBlockIndex as number)++;
      state.thinkingBlockStarted = true;
      results.push({ type: 'content_block_start', index: state.thinkingBlockIndex, content_block: { type: 'thinking', thinking: '' } });
    }
    results.push({ type: 'content_block_delta', index: state.thinkingBlockIndex, delta: { type: 'thinking_delta', thinking: reasoningContent } });
  }

  if (delta.content) {
    stopThinkingBlock(state, results);
    if (!state.textBlockStarted) {
      state.textBlockIndex = (state.nextBlockIndex as number)++;
      state.textBlockStarted = true; state.textBlockClosed = false;
      results.push({ type: 'content_block_start', index: state.textBlockIndex, content_block: { type: 'text', text: '' } });
    }
    results.push({ type: 'content_block_delta', index: state.textBlockIndex, delta: { type: 'text_delta', text: delta.content } });
  }

  if (delta.tool_calls) {
    if (!state.toolCalls) state.toolCalls = new Map();
    if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
    for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
      const idx = (tc.index as number) ?? 0;
      if (tc.id) {
        stopThinkingBlock(state, results); stopTextBlock(state, results);
        const toolBlockIndex = (state.nextBlockIndex as number)++;
        (state.toolCalls as Map<number, Record<string, unknown>>).set(idx, { id: tc.id, name: (tc.function as Record<string, unknown>)?.name || '', blockIndex: toolBlockIndex });
        results.push({ type: 'content_block_start', index: toolBlockIndex, content_block: { type: 'tool_use', id: tc.id, name: (tc.function as Record<string, unknown>)?.name || '', input: {} } });
      }
      if ((tc.function as Record<string, unknown>)?.arguments) {
        const toolInfo = (state.toolCalls as Map<number, Record<string, unknown>>).get(idx);
        if (toolInfo) (state.toolArgBuffers as Map<number, string>).set(idx, ((state.toolArgBuffers as Map<number, string>).get(idx) || '') + ((tc.function as Record<string, unknown>).arguments as string));
      }
    }
  }

  if (choice.finish_reason) {
    stopThinkingBlock(state, results); stopTextBlock(state, results);
    if (state.toolCalls) {
      for (const [idx, toolInfo] of state.toolCalls as Map<number, Record<string, unknown>>) {
        const buffered = (state.toolArgBuffers as Map<number, string>)?.get(idx);
        if (buffered) results.push({ type: 'content_block_delta', index: toolInfo.blockIndex, delta: { type: 'input_json_delta', partial_json: buffered } });
        results.push({ type: 'content_block_stop', index: toolInfo.blockIndex });
      }
    }
    state.finishReason = choice.finish_reason;
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({ type: 'message_delta', delta: { stop_reason: convertFinishReason(choice.finish_reason as string) }, usage: finalUsage });
    results.push({ type: 'message_stop' });
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeResponse);
