// Gemini to OpenAI response translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, DEFAULT_IMAGE_MIME } from '../schema/index.js';
import { buildChunk } from '../concerns/chunk.js';
import { toOpenAIUsage } from '../concerns/usage.js';
import { reasoningDelta } from '../concerns/reasoning.js';
import { encodeDataUri } from '../concerns/image.js';
import { toOpenAIFinish } from '../concerns/finishReason.js';

function chunkMeta(state: Record<string, unknown>) {
  return { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model as string };
}

function emitFunctionCall(functionCall: Record<string, unknown>, state: Record<string, unknown>) {
  const fcName = (state.toolNameMap as Map<string, string>)?.get(functionCall.name as string) || functionCall.name;
  const fcArgs = functionCall.args || {};
  const toolCallIndex = (state.functionIndex as number)++;
  const toolCall = { id: `${fcName}-${Date.now()}-${toolCallIndex}`, index: toolCallIndex, type: OPENAI_BLOCK.FUNCTION, function: { name: fcName, arguments: JSON.stringify(fcArgs) } };
  state.geminiToolCallCount = ((state.geminiToolCallCount as number) || 0) + 1;
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
}

export function geminiToOpenAIResponse(chunk: Record<string, unknown>, state: Record<string, unknown>): unknown[] | null {
  if (!chunk) return null;
  const response = (chunk.response as Record<string, unknown>) || chunk;
  if (!response || !(response.candidates as unknown[])?.[0]) return null;

  const results: unknown[] = [];
  const candidate = (response.candidates as Array<Record<string, unknown>>)[0];
  const content = candidate.content as Record<string, unknown>;

  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || 'gemini';
    state.functionIndex = 0;
    state.geminiToolCallCount = 0;
    results.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
  }

  if (content?.parts) {
    for (const part of content.parts as Array<Record<string, unknown>>) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      const isThought = part.thought === true;
      if (hasThoughtSig) {
        if (part.text !== undefined && part.text !== '') results.push(buildChunk(chunkMeta(state), isThought ? reasoningDelta(part.text as string) : { content: part.text }, null));
        if (part.functionCall) results.push(emitFunctionCall(part.functionCall as Record<string, unknown>, state));
        continue;
      }
      if (part.text !== undefined && part.text !== '') results.push(buildChunk(chunkMeta(state), isThought ? reasoningDelta(part.text as string) : { content: part.text }, null));
      if (part.functionCall) results.push(emitFunctionCall(part.functionCall as Record<string, unknown>, state));
      const inlineData = part.inlineData || part.inline_data;
      if ((inlineData as Record<string, unknown>)?.data) {
        const id = inlineData as Record<string, unknown>;
        results.push(buildChunk(chunkMeta(state), { images: [{ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: encodeDataUri((id.mimeType || id.mime_type || DEFAULT_IMAGE_MIME) as string, id.data as string) } }] }, null));
      }
    }
  }

  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  const geminiUsage = toOpenAIUsage(usageMeta as Record<string, unknown>, 'gemini');
  if (geminiUsage) state.usage = geminiUsage;

  if (candidate.finishReason) {
    let finishReason = toOpenAIFinish(candidate.finishReason as string, 'gemini');
    if (finishReason === OPENAI_FINISH.STOP && (state.geminiToolCallCount as number) > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;
    const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
    if (state.usage) (finalChunk as Record<string, unknown>).usage = state.usage;
    results.push(finalChunk);
    state.finishReason = finishReason;
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);
