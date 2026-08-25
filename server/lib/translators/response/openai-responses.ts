// OpenAI ↔ OpenAI Responses API response translators
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { buildChunk } from '../concerns/chunk.js';
import { buildUsage } from '../concerns/usage.js';
import { fallbackToolCallId } from '../concerns/toolCall.js';
import { reasoningDelta, extractReasoningText } from '../concerns/reasoning.js';
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from '../schema/index.js';

export function openaiToOpenAIResponsesResponse(chunk: Record<string, unknown> | null, state: Record<string, unknown>): unknown[] {
  if (!chunk) return [];
  if (!(chunk.choices as unknown[])?.length) return [];

  const events: unknown[] = [];
  const nextSeq = () => ++(state.seq as number);
  const emit = (eventType: string, data: Record<string, unknown>) => { data.sequence_number = nextSeq(); events.push({ event: eventType, data }); };

  const choice = (chunk.choices as Array<Record<string, unknown>>)[0];
  const idx = (choice.index as number) || 0;
  const delta = (choice.delta || {}) as Record<string, unknown>;

  if (!state.started) {
    state.started = true;
    state.responseId = chunk.id ? `resp_${chunk.id}` : state.responseId;
    emit('response.created', { type: 'response.created', response: { id: state.responseId, object: 'response', created_at: state.created, status: 'in_progress', background: false, error: null, output: [] } });
    emit('response.in_progress', { type: 'response.in_progress', response: { id: state.responseId, object: 'response', created_at: state.created, status: 'in_progress' } });
  }

  const reasoningText = extractReasoningText(delta);
  if (reasoningText) {
    if (!state.reasoningId) {
      state.reasoningId = `rs_${state.responseId}_${idx}`;
      state.reasoningIndex = idx;
      emit('response.output_item.added', { type: 'response.output_item.added', output_index: idx, item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] } });
      emit('response.reasoning_summary_part.added', { type: 'response.reasoning_summary_part.added', item_id: state.reasoningId, output_index: idx, summary_index: 0, part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: '' } });
      state.reasoningPartAdded = true;
    }
    state.reasoningBuf = ((state.reasoningBuf as string) || '') + reasoningText;
    emit('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', item_id: state.reasoningId, output_index: state.reasoningIndex, summary_index: 0, delta: reasoningText });
  }

  if (delta.content) {
    if (!state.msgItemAdded) state.msgItemAdded = {};
    if (!(state.msgItemAdded as Record<string, boolean>)[idx]) {
      (state.msgItemAdded as Record<string, boolean>)[idx] = true;
      const msgId = `msg_${state.responseId}_${idx}`;
      emit('response.output_item.added', { type: 'response.output_item.added', output_index: idx, item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT } });
    }
    if (!state.msgContentAdded) state.msgContentAdded = {};
    if (!(state.msgContentAdded as Record<string, boolean>)[idx]) {
      (state.msgContentAdded as Record<string, boolean>)[idx] = true;
      emit('response.content_part.added', { type: 'response.content_part.added', item_id: `msg_${state.responseId}_${idx}`, output_index: idx, content_index: 0, part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: '' } });
    }
    emit('response.output_text.delta', { type: 'response.output_text.delta', item_id: `msg_${state.responseId}_${idx}`, output_index: idx, content_index: 0, delta: delta.content, logprobs: [] });
    if (!state.msgTextBuf) state.msgTextBuf = {};
    (state.msgTextBuf as Record<string, string>)[idx] = ((state.msgTextBuf as Record<string, string>)[idx] || '') + (delta.content as string);
  }

  if (choice.finish_reason) {
    if (state.reasoningId && !state.reasoningDone) {
      state.reasoningDone = true;
      emit('response.reasoning_summary_text.done', { type: 'response.reasoning_summary_text.done', item_id: state.reasoningId, output_index: state.reasoningIndex, summary_index: 0, text: state.reasoningBuf });
      emit('response.output_item.done', { type: 'response.output_item.done', output_index: state.reasoningIndex, item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }] } });
    }
    if (!state.completedSent) {
      state.completedSent = true;
      emit('response.completed', { type: 'response.completed', response: { id: state.responseId, object: 'response', created_at: state.created, status: 'completed', background: false, error: null } });
    }
  }

  return events;
}

export function openaiResponsesToOpenAIResponse(chunk: Record<string, unknown> | null, state: Record<string, unknown>): unknown {
  if (!chunk) {
    if (state.finishReasonSent || !state.started) return null;
    const finishReason = OPENAI_FINISH.STOP;
    state.finishReasonSent = true;
    state.finishReason = finishReason;
    const finalChunk = buildChunk({ id: (state.chatId as string) || `chatcmpl-${Date.now()}`, created: (state.created as number) || Math.floor(Date.now() / 1000), model: (state.model as string) || MODEL_FALLBACK }, {}, finishReason);
    if (state.usage) (finalChunk as Record<string, unknown>).usage = state.usage;
    return finalChunk;
  }

  const eventType = (chunk.type || chunk.event) as string;
  const data = (chunk.data || chunk) as Record<string, unknown>;

  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolCallIndex = 0;
    state.currentToolCallId = null;
  }

  if (eventType === 'response.output_text.delta') {
    const deltaText = (data.delta || '') as string;
    if (!deltaText) return null;
    return buildChunk({ id: state.chatId as string, created: state.created as number, model: (state.model as string) || MODEL_FALLBACK }, { content: deltaText });
  }

  if (eventType === 'response.output_item.added' && ((data.item as Record<string, unknown>)?.type === RESPONSES_ITEM.FUNCTION_CALL || (data.item as Record<string, unknown>)?.type === 'custom_tool_call')) {
    const item = data.item as Record<string, unknown>;
    state.currentToolCallId = (item.call_id as string) || fallbackToolCallId();
    return buildChunk({ id: state.chatId as string, created: state.created as number, model: (state.model as string) || MODEL_FALLBACK }, { tool_calls: [{ index: state.toolCallIndex, id: state.currentToolCallId, type: OPENAI_BLOCK.FUNCTION, function: { name: item.name || '', arguments: '' } }] });
  }

  if (eventType === 'response.function_call_arguments.delta' || eventType === 'response.custom_tool_call_input.delta') {
    const argsDelta = (data.delta || '') as string;
    if (!argsDelta) return null;
    return buildChunk({ id: state.chatId as string, created: state.created as number, model: (state.model as string) || MODEL_FALLBACK }, { tool_calls: [{ index: state.toolCallIndex, function: { arguments: argsDelta } }] });
  }

  if (eventType === 'response.output_item.done' && ((data.item as Record<string, unknown>)?.type === RESPONSES_ITEM.FUNCTION_CALL || (data.item as Record<string, unknown>)?.type === 'custom_tool_call')) {
    state.toolCallIndex = (state.toolCallIndex as number) + 1;
    return null;
  }

  if (eventType === 'response.completed' || eventType === 'response.done') {
    const responseUsage = (data.response as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
    if (responseUsage && typeof responseUsage === 'object') {
      const inputTokens = (responseUsage.input_tokens || responseUsage.prompt_tokens || 0) as number;
      const outputTokens = (responseUsage.output_tokens || responseUsage.completion_tokens || 0) as number;
      const cacheReadTokens = ((responseUsage.input_tokens_details as Record<string, unknown>)?.cached_tokens || responseUsage.cache_read_input_tokens || 0) as number;
      state.usage = buildUsage({ promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens: cacheReadTokens });
    }
    if (!state.finishReasonSent) {
      state.finishReasonSent = true;
      state.finishReason = OPENAI_FINISH.STOP;
      const finalChunk = buildChunk({ id: state.chatId as string, created: state.created as number, model: (state.model as string) || MODEL_FALLBACK }, {}, OPENAI_FINISH.STOP);
      if (state.usage) (finalChunk as Record<string, unknown>).usage = state.usage;
      return finalChunk;
    }
    return null;
  }

  if (eventType === 'response.reasoning_summary_text.delta') {
    const deltaText = (data.delta || '') as string;
    if (!deltaText) return null;
    return buildChunk({ id: state.chatId as string, created: state.created as number, model: (state.model as string) || MODEL_FALLBACK }, reasoningDelta(deltaText));
  }

  return null;
}

register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
