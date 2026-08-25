// Kiro to OpenAI response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK } from '../schema/index.js';
import { buildChunk } from '../concerns/chunk.js';
import { toOpenAIUsage } from '../concerns/usage.js';
import { fallbackToolCallId } from '../concerns/toolCall.js';
import { reasoningDelta } from '../concerns/reasoning.js';
import { toOpenAIFinish } from '../concerns/finishReason.js';

function chunkMeta(state: Record<string, unknown>) {
  return { id: state.responseId as string, created: state.created as number, model: (state.model as string) || 'kiro' };
}

export function kiroToOpenAIResponse(chunk: unknown, state: Record<string, unknown>): unknown[] | null {
  if (!chunk) return null;
  if (typeof chunk === 'object' && (chunk as Record<string, unknown>).object === 'chat.completion.chunk' && (chunk as Record<string, unknown>).choices) return [chunk];

  let data: Record<string, unknown> = chunk as Record<string, unknown>;
  if (typeof chunk === 'string') {
    const lines = chunk.split('\n');
    let eventType = ''; let eventData = '';
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith(':event-type:')) eventType = line.slice(12).trim();
      else if (line.startsWith('data:')) eventData = line.slice(5).trim();
      else if (line.trim() && !line.startsWith(':')) eventData = line.trim();
    }
    if (!eventData) return null;
    try { data = JSON.parse(eventData); data._eventType = eventType; } catch { data = { text: eventData, _eventType: eventType }; }
  }

  if (!state.responseId) { state.responseId = `chatcmpl-${Date.now()}`; state.created = Math.floor(Date.now() / 1000); state.chunkIndex = 0; }

  const eventType = (data._eventType || data.event || '') as string;

  if (eventType === 'assistantResponseEvent' || data.assistantResponseEvent) {
    const content = ((data.assistantResponseEvent as Record<string, unknown>)?.content || data.content || '') as string;
    if (!content) return null;
    const openaiChunk = buildChunk(chunkMeta(state), { ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}), content }, null);
    state.chunkIndex = (state.chunkIndex as number) + 1;
    return [openaiChunk];
  }

  if (eventType === 'reasoningContentEvent' || data.reasoningContentEvent) {
    const reasoning = data.reasoningContentEvent || data;
    const content = (typeof reasoning === 'string') ? reasoning : ((reasoning as Record<string, unknown>).text || (reasoning as Record<string, unknown>).content || data.content || '') as string;
    if (!content) return null;
    const openaiChunk = buildChunk(chunkMeta(state), reasoningDelta(content, state.chunkIndex === 0), null);
    state.chunkIndex = (state.chunkIndex as number) + 1;
    return [openaiChunk];
  }

  if (eventType === 'toolUseEvent' || data.toolUseEvent) {
    state.hadToolUse = true;
    const toolUse = data.toolUseEvent || data;
    const tu = toolUse as Record<string, unknown>;
    const toolCallId = (tu.toolUseId as string) || fallbackToolCallId();
    const openaiChunk = buildChunk(chunkMeta(state), { ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}), tool_calls: [{ index: 0, id: toolCallId, type: OPENAI_BLOCK.FUNCTION, function: { name: tu.name || '', arguments: JSON.stringify(tu.input || {}) } }] }, null);
    state.chunkIndex = (state.chunkIndex as number) + 1;
    return [openaiChunk];
  }

  if (eventType === 'messageStopEvent' || eventType === 'done' || data.messageStopEvent) {
    const finishReason = toOpenAIFinish(state.hadToolUse ? 'tool_use' : 'stop', 'kiro');
    state.finishReason = finishReason;
    const openaiChunk = buildChunk(chunkMeta(state), {}, finishReason);
    if (state.usage) (openaiChunk as Record<string, unknown>).usage = state.usage;
    return [openaiChunk];
  }

  if (eventType === 'usageEvent' || data.usageEvent) {
    const usage = toOpenAIUsage((data.usageEvent || data) as Record<string, unknown>, 'kiro');
    if (usage) state.usage = usage;
    return null;
  }

  return null;
}

register(FORMATS.KIRO, FORMATS.OPENAI, null, kiroToOpenAIResponse);
