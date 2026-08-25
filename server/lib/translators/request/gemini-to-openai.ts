// Convert Gemini request to OpenAI format
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { adjustMaxTokens } from '../formats/maxTokens.js';
import { encodeDataUri } from '../concerns/image.js';
import { collapseTextParts } from '../concerns/message.js';
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from '../schema/index.js';

export function geminiToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = { model, messages: [], stream };

  if (body.generationConfig) {
    const config = body.generationConfig as Record<string, unknown>;
    if (config.maxOutputTokens) {
      result.max_tokens = adjustMaxTokens({ max_tokens: config.maxOutputTokens as number, tools: body.tools });
    }
    if (config.temperature !== undefined) result.temperature = config.temperature;
    if (config.topP !== undefined) result.top_p = config.topP;
  }

  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) (result.messages as unknown[]).push({ role: ROLE.SYSTEM, content: systemText });
  }

  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents as Array<Record<string, unknown>>) {
      const converted = convertGeminiContent(content);
      if (converted) (result.messages as unknown[]).push(converted);
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations as Array<Record<string, unknown>>) {
          (result.tools as unknown[]).push({
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: func.name, description: func.description || '', parameters: func.parameters || { type: 'object', properties: {} } },
          });
        }
      }
    }
  }

  return result;
}

function convertGeminiContent(content: Record<string, unknown>): Record<string, unknown> | null {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  if (!content.parts || !Array.isArray(content.parts)) return null;

  const parts: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];

  for (const part of content.parts as Array<Record<string, unknown>>) {
    if (part.text !== undefined) parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    if (part.inlineData) {
      const id = part.inlineData as Record<string, unknown>;
      parts.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: encodeDataUri(id.mimeType as string, id.data as string) } });
    }
    if (part.functionCall) {
      const fc = part.functionCall as Record<string, unknown>;
      toolCalls.push({
        id: fc.id || `call_${fc.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) },
      });
    }
    if (part.functionResponse) {
      const fr = part.functionResponse as Record<string, unknown>;
      return {
        role: ROLE.TOOL,
        tool_call_id: fr.id || `call_${fr.name}`,
        content: JSON.stringify((fr.response as Record<string, unknown>)?.result || fr.response || {}),
      };
    }
  }

  if (toolCalls.length > 0) {
    const result: Record<string, unknown> = { role: ROLE.ASSISTANT };
    if (parts.length > 0) result.content = parts.length === 1 ? parts[0].text : parts;
    result.tool_calls = toolCalls;
    return result;
  }

  if (parts.length > 0) return { role, content: collapseTextParts(parts) };
  return null;
}

function extractGeminiText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)) {
    return ((content as Record<string, unknown>).parts as Array<Record<string, unknown>>).map(p => (p.text as string) || '').join('');
  }
  return '';
}

register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
