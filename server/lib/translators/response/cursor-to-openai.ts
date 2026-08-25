// Cursor to OpenAI response translator (passthrough)
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';

export function cursorToOpenAIResponse(chunk: unknown, _state: Record<string, unknown>): unknown {
  if (!chunk) return null;
  const c = chunk as Record<string, unknown>;
  if (c.object === 'chat.completion.chunk' && c.choices) return chunk;
  if (c.object === 'chat.completion' && c.choices) return chunk;
  return chunk;
}

register(FORMATS.CURSOR, FORMATS.OPENAI, null, cursorToOpenAIResponse);
