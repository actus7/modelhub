// OpenAI to Antigravity response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { GEMINI_ROLE, OPENAI_FINISH, GEMINI_FINISH } from '../schema/index.js';

export function openaiToAntigravityResponse(chunk: Record<string, unknown>, state: Record<string, unknown>): unknown {
  if (!chunk) return null;
  const choice = (chunk.choices as Array<Record<string, unknown>>)?.[0];
  if (!choice) {
    if (chunk.usage) state._usage = chunk.usage;
    return null;
  }

  const delta = (choice.delta || {}) as Record<string, unknown>;
  const finishReason = choice.finish_reason as string;

  if (!state._toolCallAccum) state._toolCallAccum = {};
  if (!state._responseId) state._responseId = chunk.id || `resp_${Date.now()}`;
  if (!state._modelVersion) state._modelVersion = chunk.model || '';

  const parts: Record<string, unknown>[] = [];

  if (delta.reasoning_content) parts.push({ thought: true, text: delta.reasoning_content });
  if (delta.content) parts.push({ text: delta.content });

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
      const idx = (tc.index as number) ?? 0;
      if (!(state._toolCallAccum as Record<string, Record<string, unknown>>)[idx]) (state._toolCallAccum as Record<string, Record<string, unknown>>)[idx] = { id: '', name: '', arguments: '' };
      const accum = (state._toolCallAccum as Record<string, Record<string, unknown>>)[idx];
      if (tc.id) accum.id = tc.id;
      if ((tc.function as Record<string, unknown>)?.name) accum.name += String((tc.function as Record<string, unknown>).name);
      if ((tc.function as Record<string, unknown>)?.arguments) accum.arguments += String((tc.function as Record<string, unknown>).arguments);
    }
    if (parts.length === 0 && !finishReason) return null;
  }

  if (finishReason) {
    for (const idx of Object.keys(state._toolCallAccum as Record<string, Record<string, unknown>>)) {
      const accum = (state._toolCallAccum as Record<string, Record<string, unknown>>)[idx];
      let args = {};
      try { args = JSON.parse(accum.arguments as string); } catch { /* empty */ }
      const originalName = (state.toolNameMap as Map<string, string>)?.get(accum.name as string) || accum.name;
      parts.push({ functionCall: { name: originalName, args } });
    }
  }

  if (parts.length === 0 && !finishReason) return null;
  if (parts.length === 0 && finishReason) parts.push({ text: '' });

  const candidate: Record<string, unknown> = { content: { role: GEMINI_ROLE.MODEL, parts } };
  if (finishReason) {
    const reasonMap: Record<string, string> = { [OPENAI_FINISH.STOP]: GEMINI_FINISH.STOP, [OPENAI_FINISH.LENGTH]: GEMINI_FINISH.MAX_TOKENS, [OPENAI_FINISH.TOOL_CALLS]: GEMINI_FINISH.STOP, [OPENAI_FINISH.CONTENT_FILTER]: GEMINI_FINISH.SAFETY };
    candidate.finishReason = reasonMap[finishReason] || GEMINI_FINISH.STOP;
  }

  const response: Record<string, unknown> = { candidates: [candidate], modelVersion: state._modelVersion, responseId: state._responseId };
  const usage = chunk.usage || state._usage;
  if (usage) {
    const u = usage as Record<string, unknown>;
    response.usageMetadata = { promptTokenCount: u.prompt_tokens || 0, candidatesTokenCount: u.completion_tokens || 0, totalTokenCount: u.total_tokens || 0 };
  }

  return { response };
}

register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, null, openaiToAntigravityResponse);
