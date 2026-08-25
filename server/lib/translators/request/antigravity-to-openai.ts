// Convert Antigravity request to OpenAI format
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { adjustMaxTokens } from '../formats/maxTokens.js';
import { encodeDataUri } from '../concerns/image.js';
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from '../schema/index.js';
import { budgetToEffort } from '../concerns/thinking.js';
import { collapseTextParts } from '../concerns/message.js';

export function antigravityToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const req = (body.request as Record<string, unknown>) || body;
  const result: Record<string, unknown> = { model, messages: [], stream };

  if (req.generationConfig) {
    const config = req.generationConfig as Record<string, unknown>;
    if (config.maxOutputTokens) result.max_tokens = adjustMaxTokens({ max_tokens: config.maxOutputTokens as number, tools: req.tools });
    if (config.temperature !== undefined) result.temperature = config.temperature;
    if (config.topP !== undefined) result.top_p = config.topP;
    if (config.topK !== undefined) result.top_k = config.topK;
    if (config.thinkingConfig) {
      const tc = config.thinkingConfig as Record<string, unknown>;
      const effort = budgetToEffort((tc.thinkingBudget as number) || 0);
      if (effort) result.reasoning_effort = effort;
    }
  }

  if (req.systemInstruction) {
    const systemText = extractText(req.systemInstruction);
    if (systemText) (result.messages as unknown[]).push({ role: ROLE.SYSTEM, content: systemText });
  }

  if (req.contents && Array.isArray(req.contents)) {
    for (const content of req.contents as Array<Record<string, unknown>>) {
      const converted = convertContent(content);
      if (converted) {
        if (Array.isArray(converted)) (result.messages as unknown[]).push(...converted);
        else (result.messages as unknown[]).push(converted);
      }
    }
  }

  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools as Array<Record<string, unknown>>) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations as Array<Record<string, unknown>>) {
          (result.tools as unknown[]).push({
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: func.name, description: func.description || '', parameters: normalizeSchemaTypes(func.parameters) || { type: 'object', properties: {} } },
          });
        }
      }
    }
  }

  return result;
}

function normalizeSchemaTypes(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const result: Record<string, unknown> = Array.isArray(schema) ? { items: schema } : { ...(schema as Record<string, unknown>) };
  if (typeof result.type === 'string') result.type = result.type.toLowerCase();
  delete result.enumDescriptions;
  if (result.properties) {
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(result.properties as Record<string, unknown>)) {
      normalized[key] = normalizeSchemaTypes(val);
    }
    result.properties = normalized;
  }
  if (result.items) result.items = normalizeSchemaTypes(result.items);
  return result;
}

function convertContent(content: Record<string, unknown>): Record<string, unknown> | Record<string, unknown>[] | null {
  const role = content.role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : content.role === GEMINI_ROLE.USER ? ROLE.USER : content.role as string;
  if (!content.parts || !Array.isArray(content.parts)) return null;

  const textParts: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  const toolResults: Record<string, unknown>[] = [];
  let reasoningContent = '';

  for (const part of content.parts as Array<Record<string, unknown>>) {
    if (part.thought === true && part.text) { reasoningContent += part.text as string; continue; }
    if (part.thoughtSignature && part.text !== undefined) {
      if (part.text) textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
      continue;
    }
    if (part.text !== undefined && part.text !== '') textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    if (part.inlineData) {
      const id = part.inlineData as Record<string, unknown>;
      textParts.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: encodeDataUri(id.mimeType as string, id.data as string) } });
    }
    if (part.functionCall) {
      const fc = part.functionCall as Record<string, unknown>;
      toolCalls.push({ id: fc.id || `call_${fc.name}`, type: OPENAI_BLOCK.FUNCTION, function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) } });
    }
    if (part.functionResponse) {
      const fr = part.functionResponse as Record<string, unknown>;
      toolResults.push({ role: ROLE.TOOL, tool_call_id: fr.id || `call_${fr.name}`, content: JSON.stringify((fr.response as Record<string, unknown>)?.result || fr.response || {}) });
    }
  }

  if (toolResults.length > 0) {
    if (toolCalls.length > 0 || textParts.length > 0 || reasoningContent) {
      const assistantMsg: Record<string, unknown> = { role: ROLE.ASSISTANT };
      if (textParts.length > 0) assistantMsg.content = collapseTextParts(textParts);
      if (reasoningContent) assistantMsg.reasoning_content = reasoningContent;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      return [...toolResults, assistantMsg];
    }
    return toolResults;
  }

  if (toolCalls.length > 0) {
    const msg: Record<string, unknown> = { role: ROLE.ASSISTANT };
    if (textParts.length > 0) msg.content = collapseTextParts(textParts);
    if (reasoningContent) msg.reasoning_content = reasoningContent;
    msg.tool_calls = toolCalls;
    return msg;
  }

  if (textParts.length > 0 || reasoningContent) {
    const msg: Record<string, unknown> = { role };
    if (textParts.length > 0) msg.content = collapseTextParts(textParts);
    if (reasoningContent) msg.reasoning_content = reasoningContent;
    return msg;
  }

  return null;
}

function extractText(instruction: unknown): string {
  if (typeof instruction === 'string') return instruction;
  if (instruction && typeof instruction === 'object' && Array.isArray((instruction as Record<string, unknown>).parts)) {
    return ((instruction as Record<string, unknown>).parts as Array<Record<string, unknown>>).map(p => (p.text as string) || '').join('');
  }
  return '';
}

register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, antigravityToOpenAIRequest, null);
