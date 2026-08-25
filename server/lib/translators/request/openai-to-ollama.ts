// OpenAI to Ollama request translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { parseDataUri } from '../concerns/image.js';
import { safeParseJSON } from '../concerns/json.js';
import { ROLE, OPENAI_BLOCK } from '../schema/index.js';

export function openaiToOllamaRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model,
    messages: normalizeMessages(body.messages as Array<Record<string, unknown>>),
    stream,
  };

  if (body.temperature !== undefined) { result.options = result.options || {}; (result.options as Record<string, unknown>).temperature = body.temperature; }
  if (body.max_tokens !== undefined) { result.options = result.options || {}; (result.options as Record<string, unknown>).num_predict = body.max_tokens; }
  if (body.top_p !== undefined) { result.options = result.options || {}; (result.options as Record<string, unknown>).top_p = body.top_p; }
  if (body.tools && Array.isArray(body.tools)) result.tools = body.tools;
  if (body.tool_choice) result.tool_choice = body.tool_choice;

  return result;
}

function normalizeMessages(messages: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return messages || [];
  const result: Record<string, unknown>[] = [];
  const toolCallMap = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        if (tc.id && (tc.function as Record<string, unknown>)?.name) toolCallMap.set(tc.id as string, (tc.function as Record<string, unknown>).name as string);
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === ROLE.TOOL) {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;
      const toolName = toolCallMap.get(msg.tool_call_id as string) || (msg.name as string) || 'unknown_tool';
      result.push({ role: ROLE.TOOL, tool_name: toolName, content: toolResult });
      continue;
    }
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      const content = normalizeContent(msg.content) || '';
      const ollamaToolCalls = (msg.tool_calls as Array<Record<string, unknown>>).map(tc => ({
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          index: tc.index || 0,
          name: (tc.function as Record<string, unknown>)?.name || '',
          arguments: typeof (tc.function as Record<string, unknown>)?.arguments === 'string'
            ? safeParseJSON((tc.function as Record<string, unknown>).arguments as string || '{}', {})
            : (tc.function as Record<string, unknown>)?.arguments || {},
        },
      }));
      result.push({ role: ROLE.ASSISTANT, content, tool_calls: ollamaToolCalls });
      continue;
    }
    const role = msg.role as string;
    const content = normalizeContent(msg.content);
    const images = extractImagesFromContent(msg.content);
    if (!content && role !== ROLE.ASSISTANT) continue;
    const out: Record<string, unknown> = { role, content };
    if (images.length > 0) out.images = images;
    result.push(out);
  }
  return result;
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter(block => block && block.type === OPENAI_BLOCK.TEXT && block.text)
      .map(block => block.text as string).join('\n') || '';
  }
  return '';
}

function extractImagesFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const images: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (!block || block.type !== OPENAI_BLOCK.IMAGE_URL) continue;
    const url = typeof block.image_url === 'string' ? block.image_url : (block.image_url as Record<string, unknown>)?.url as string;
    if (typeof url !== 'string' || !url) continue;
    const parsed = parseDataUri(url);
    if (parsed) images.push(parsed.base64);
  }
  return images;
}

register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
