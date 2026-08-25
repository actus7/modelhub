// CommandCode to OpenAI response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from '../schema/index.js';
import { buildChunk } from '../concerns/chunk.js';
import { toOpenAIUsage } from '../concerns/usage.js';
import { reasoningDelta } from '../concerns/reasoning.js';
import { fallbackToolCallId } from '../concerns/toolCall.js';
import { toOpenAIFinish } from '../concerns/finishReason.js';

function ensureState(state: Record<string, unknown>, model: string): void {
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.model = state.model || model || 'commandcode';
    state.chunkIndex = 0;
    state.toolIndex = 0;
    state.toolIndexById = new Map<string, number>();
    state.openTools = new Set<string>();
    state.finishReason = null;
    state.usage = null;
  }
}

function makeChunk(state: Record<string, unknown>, delta: Record<string, unknown>, finishReason: string | null = null) {
  return buildChunk({ id: state.responseId as string, created: state.created as number, model: state.model as string }, delta, finishReason);
}

export function commandCodeToOpenAIResponse(chunk: unknown, state: Record<string, unknown>): unknown[] | null {
  if (!chunk) return null;
  if (typeof chunk === 'object' && (chunk as Record<string, unknown>).object === 'chat.completion.chunk') return [chunk];

  let event: Record<string, unknown> = chunk as Record<string, unknown>;
  if (typeof chunk === 'string') {
    const line = chunk.trim();
    if (!line) return null;
    const json = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (!json || json === '[DONE]') return null;
    try { event = JSON.parse(json); } catch { return null; }
  }
  if (!event || typeof event !== 'object' || !event.type) return null;

  ensureState(state, event.model as string);
  const out: unknown[] = [];

  switch (event.type) {
    case 'text-delta': {
      const text = (event.text || event.delta || '') as string;
      if (!text) break;
      const delta = state.chunkIndex === 0 ? { role: ROLE.ASSISTANT, content: text } : { content: text };
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case 'reasoning-delta': {
      const text = (event.text || '') as string;
      if (!text) break;
      const delta = reasoningDelta(text, state.chunkIndex === 0);
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case 'tool-input-start': {
      const id = (event.id || event.toolCallId || fallbackToolCallId(state.toolIndex as number)) as string;
      let idx = (state.toolIndexById as Map<string, number>).get(id);
      if (idx == null) { idx = state.toolIndex as number; (state.toolIndexById as Map<string, number>).set(id, idx); state.toolIndex = (state.toolIndex as number) + 1; }
      const delta = { ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}), tool_calls: [{ index: idx, id, type: OPENAI_BLOCK.FUNCTION, function: { name: event.toolName || '', arguments: '' } }] };
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case 'tool-input-delta': {
      const id = (event.id || event.toolCallId) as string;
      const idx = (state.toolIndexById as Map<string, number>).get(id);
      if (idx == null) break;
      out.push(makeChunk(state, { tool_calls: [{ index: idx, function: { arguments: event.delta || event.inputTextDelta || '' } }] }));
      break;
    }
    case 'tool-call': {
      const id = event.toolCallId as string;
      if ((state.toolIndexById as Map<string, number>).has(id)) break;
      const idx = state.toolIndex as number;
      (state.toolIndexById as Map<string, number>).set(id, idx);
      state.toolIndex = (state.toolIndex as number) + 1;
      const argsStr = typeof event.input === 'string' ? event.input : JSON.stringify(event.input ?? {});
      out.push(makeChunk(state, { ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}), tool_calls: [{ index: idx, id, type: OPENAI_BLOCK.FUNCTION, function: { name: event.toolName || '', arguments: argsStr } }] }));
      state.chunkIndex = (state.chunkIndex as number) + 1;
      break;
    }
    case 'finish-step': {
      state.finishReason = toOpenAIFinish(event.finishReason as string, 'commandcode');
      if (event.usage) state.usage = event.usage;
      break;
    }
    case 'finish': {
      const finishReason = (state.finishReason as string) || toOpenAIFinish((event.finishReason || 'stop') as string, 'commandcode');
      const finalChunk = makeChunk(state, {}, finishReason);
      const totalUsage = event.totalUsage || state.usage;
      const usage = toOpenAIUsage(totalUsage as Record<string, unknown>, 'commandcode');
      if (usage) (finalChunk as Record<string, unknown>).usage = usage;
      out.push(finalChunk);
      break;
    }
    case 'error': {
      state.finishReason = OPENAI_FINISH.STOP;
      const errStr = typeof (event.error ?? event.message) === 'string' ? (event.error ?? event.message) as string : 'unknown';
      out.push(makeChunk(state, { content: `\n\n[CommandCode error: ${errStr}]` }));
      out.push(makeChunk(state, {}, OPENAI_FINISH.STOP));
      break;
    }
  }

  return out.length ? out : null;
}

register(FORMATS.COMMANDCODE, FORMATS.OPENAI, null, commandCodeToOpenAIResponse);
