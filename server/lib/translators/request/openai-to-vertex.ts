// OpenAI to Vertex request translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { openaiToGeminiRequest } from './openai-to-gemini.js';

function postProcessForVertex(body: Record<string, unknown>): Record<string, unknown> {
  if (!body?.contents) return body;
  for (const turn of body.contents as Array<Record<string, unknown>>) {
    if (!Array.isArray(turn.parts)) continue;
    for (const part of turn.parts as Array<Record<string, unknown>>) {
      if (part.thoughtSignature !== undefined) part.thoughtSignature = 'vertex-default';
      if (part.functionCall && 'id' in (part.functionCall as Record<string, unknown>)) delete (part.functionCall as Record<string, unknown>).id;
      if (part.functionResponse && 'id' in (part.functionResponse as Record<string, unknown>)) delete (part.functionResponse as Record<string, unknown>).id;
    }
  }
  return body;
}

export function openaiToVertexRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const gemini = openaiToGeminiRequest(model, body, stream);
  return postProcessForVertex(gemini);
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
