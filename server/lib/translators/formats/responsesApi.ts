// Responses API helpers
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from '../schema/index.js';

export function normalizeResponsesInput(input: unknown): Array<Record<string, unknown>> | null {
  if (typeof input === 'string') {
    const text = input.trim() === '' ? '...' : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: '...' }] }];
    }
    return input as Array<Record<string, unknown>>;
  }
  return null;
}

export function convertResponsesApiFormat(body: Record<string, unknown>): Record<string, unknown> {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  if (body.instructions) {
    (result.messages as unknown[]).push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  let currentAssistantMsg: Record<string, unknown> | null = null;
  let pendingToolResults: Record<string, unknown>[] = [];

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  for (const item of inputItems) {
    const itemType = (item as Record<string, unknown>).type || ((item as Record<string, unknown>).role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      if (currentAssistantMsg) {
        (result.messages as unknown[]).push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) (result.messages as unknown[]).push(tr);
        pendingToolResults = [];
      }
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>).map(c => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
            const url = c.image_url || c.file_id || '';
            return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || 'auto' } };
          }
          return c;
        })
        : (item as Record<string, unknown>).content;
      (result.messages as unknown[]).push({ role: (item as Record<string, unknown>).role, content });
    } else if (itemType === RESPONSES_ITEM.FUNCTION_CALL) {
      if (!currentAssistantMsg) {
        currentAssistantMsg = { role: ROLE.ASSISTANT, content: null, tool_calls: [] };
      }
      const i = item as Record<string, unknown>;
      if (!i.name || typeof i.name !== 'string' || (i.name as string).trim() === '') continue;
      (currentAssistantMsg.tool_calls as unknown[]).push({
        id: i.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: { name: i.name, arguments: i.arguments },
      });
    } else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      if (currentAssistantMsg) {
        (result.messages as unknown[]).push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      const i = item as Record<string, unknown>;
      pendingToolResults.push({
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

  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  delete result.reasoning;

  return result;
}
