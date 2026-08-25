// OpenAI Responses API ↔ OpenAI Chat Completions request translators
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { normalizeResponsesInput } from '../formats/responsesApi.js';
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from '../schema/index.js';

const MAX_CALL_ID_LEN = 64;
const clampCallId = (id: string): string => (typeof id === 'string' && id.length > MAX_CALL_ID_LEN ? id.substring(0, MAX_CALL_ID_LEN) : id);

export function openaiResponsesToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  if (!body.input) return body;
  const result = { ...body };
  result.messages = [];

  if (body.instructions) (result.messages as unknown[]).push({ role: ROLE.SYSTEM, content: body.instructions });

  let currentAssistantMsg: Record<string, unknown> | null = null;
  let pendingToolResults: Record<string, unknown>[] = [];

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  for (const item of inputItems) {
    const i = item as Record<string, unknown>;
    const itemType = i.type || (i.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      if (currentAssistantMsg) { (result.messages as unknown[]).push(currentAssistantMsg); currentAssistantMsg = null; }
      for (const tr of pendingToolResults) (result.messages as unknown[]).push(tr);
      pendingToolResults = [];
      const content = Array.isArray(i.content)
        ? (i.content as Array<Record<string, unknown>>).map(c => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: c.image_url || c.file_id || '', detail: c.detail || 'auto' } };
          return c;
        })
        : i.content;
      (result.messages as unknown[]).push({ role: i.role, content });
    } else if (itemType === RESPONSES_ITEM.FUNCTION_CALL || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      if (!currentAssistantMsg) currentAssistantMsg = { role: ROLE.ASSISTANT, content: null, tool_calls: [] };
      if (!i.name || typeof i.name !== 'string' || (i.name as string).trim() === '') continue;
      const toolInput = itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL
        ? { input: typeof i.input === 'string' ? i.input : JSON.stringify(i.input ?? '') }
        : i.arguments;
      (currentAssistantMsg.tool_calls as unknown[]).push({
        id: i.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: i.name, arguments: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput ?? {}) },
      });
    } else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      if (currentAssistantMsg) { (result.messages as unknown[]).push(currentAssistantMsg); currentAssistantMsg = null; }
      for (const tr of pendingToolResults) (result.messages as unknown[]).push(tr);
      pendingToolResults = [];
      (result.messages as unknown[]).push({
        role: ROLE.TOOL,
        tool_call_id: i.call_id,
        content: typeof i.output === 'string' ? i.output : JSON.stringify(i.output),
      });
    } else if (itemType === RESPONSES_ITEM.REASONING) {
      continue;
    }
  }

  if (currentAssistantMsg) (result.messages as unknown[]).push(currentAssistantMsg);
  for (const tr of pendingToolResults) (result.messages as unknown[]).push(tr);

  const responseTools = [...(Array.isArray(body.tools) ? body.tools : []) as unknown[]];
  if (responseTools.length > 0) {
    result.tools = (responseTools as Array<Record<string, unknown>>)
      .map(tool => {
        if (tool.function) return tool;
        const name = tool.name as string;
        if (!name || typeof name !== 'string' || name.trim() === '') return null;
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: { name, description: String(tool.description || ''), parameters: tool.parameters || { type: 'object', properties: {} }, strict: tool.strict },
        };
      })
      .filter(Boolean);
  }

  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined) result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  if (typeof (result.reasoning as Record<string, unknown>)?.effort === 'string') result.reasoning_effort = (result.reasoning as Record<string, unknown>).effort;
  delete result.reasoning;

  return result;
}

export function openaiToOpenAIResponsesRequest(model: string, body: Record<string, unknown>, _stream: boolean): Record<string, unknown> {
  if (body.input) return { ...body, model, stream: true };

  const result: Record<string, unknown> = { model, input: [], stream: true, store: false };
  let hasSystemMessage = false;
  const messages = (body.messages || []) as Array<Record<string, unknown>>;

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      if (!hasSystemMessage) { result.instructions = typeof msg.content === 'string' ? msg.content : ''; hasSystemMessage = true; }
      continue;
    }
    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      const contentType = msg.role === ROLE.USER ? RESPONSES_ITEM.INPUT_TEXT : RESPONSES_ITEM.OUTPUT_TEXT;
      const content = typeof msg.content === 'string'
        ? [{ type: contentType, text: msg.content }]
        : Array.isArray(msg.content)
          ? (msg.content as Array<Record<string, unknown>>).map(c => {
            if (c.type === OPENAI_BLOCK.TEXT) return { type: contentType, text: c.text };
            if (c.type === OPENAI_BLOCK.IMAGE_URL) {
              const url = typeof c.image_url === 'string' ? c.image_url : (c.image_url as Record<string, unknown>)?.url;
              return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url, detail: (c.image_url as Record<string, unknown>)?.detail || 'auto' };
            }
            return { type: contentType, text: c.text || c.content || JSON.stringify(c) };
          })
          : [];
      if (content.length > 0) (result.input as unknown[]).push({ type: RESPONSES_ITEM.MESSAGE, role: msg.role, content });
    }
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        (result.input as unknown[]).push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: clampCallId(tc.id as string),
          name: (tc.function as Record<string, unknown>)?.name || '_unknown',
          arguments: (tc.function as Record<string, unknown>)?.arguments || '{}',
        });
      }
    }
    if (msg.role === ROLE.TOOL) {
      const output = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      (result.input as unknown[]).push({ type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: clampCallId(msg.tool_call_id as string), output });
    }
  }

  if (!hasSystemMessage) result.instructions = '';

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = (body.tools as Array<Record<string, unknown>>).map(tool => {
      if (tool.type === OPENAI_BLOCK.FUNCTION) {
        return { type: OPENAI_BLOCK.FUNCTION, name: (tool.function as Record<string, unknown>).name, description: String((tool.function as Record<string, unknown>).description || ''), parameters: (tool.function as Record<string, unknown>).parameters || { type: 'object', properties: {} }, strict: (tool.function as Record<string, unknown>).strict };
      }
      return tool;
    });
  }

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort, summary: 'auto' };

  return result;
}

register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest, null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest, null);
