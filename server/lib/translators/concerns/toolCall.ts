// Tool call helper functions for translator

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function fallbackToolCallId(index?: number): string {
  return index === undefined ? `call_${Date.now()}` : `call_${index}_${Date.now()}`;
}

export function generateToolCallId(msgIndex = 0, tcIndex = 0, toolName = ''): string {
  const name = toolName ? `_${toolName.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  return `call_msg${msgIndex}_tc${tcIndex}${name}`;
}

function sanitizeToolId(id: string | undefined | null): string | null {
  if (!id || typeof id !== 'string') return null;
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized.length > 0 ? sanitized : null;
}

export function ensureToolCallIds(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages;
  if (!messages || !Array.isArray(messages)) return body;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (let j = 0; j < (msg.tool_calls as unknown[]).length; j++) {
        const tc = (msg.tool_calls as Array<Record<string, unknown>>)[j];
        if (!tc.id || !TOOL_ID_PATTERN.test(tc.id as string)) {
          const sanitized = sanitizeToolId(tc.id as string);
          tc.id = sanitized || generateToolCallId(i, j, (tc.function as Record<string, unknown>)?.name as string);
        }
        if (!tc.type) tc.type = 'function';
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn?.arguments && typeof fn.arguments !== 'string') {
          fn.arguments = JSON.stringify(fn.arguments);
        }
      }
    }

    if (msg.role === 'tool' && msg.tool_call_id && !TOOL_ID_PATTERN.test(msg.tool_call_id as string)) {
      const sanitized = sanitizeToolId(msg.tool_call_id as string);
      msg.tool_call_id = sanitized || generateToolCallId(i, 0);
    }

    if (Array.isArray(msg.content)) {
      for (let k = 0; k < (msg.content as unknown[]).length; k++) {
        const block = (msg.content as Array<Record<string, unknown>>)[k];
        if (block.type === 'tool_use' && block.id && !TOOL_ID_PATTERN.test(block.id as string)) {
          const sanitized = sanitizeToolId(block.id as string);
          block.id = sanitized || generateToolCallId(i, k, block.name as string);
        }
        if (block.type === 'tool_result' && block.tool_use_id && !TOOL_ID_PATTERN.test(block.tool_use_id as string)) {
          const sanitized = sanitizeToolId(block.tool_use_id as string);
          block.tool_use_id = sanitized || generateToolCallId(i, k);
        }
      }
    }
  }

  return body;
}

export function getToolCallIds(msg: Record<string, unknown>): string[] {
  if (msg.role !== 'assistant') return [];
  const ids: string[] = [];
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
      if (tc.id) ids.push(tc.id as string);
    }
  }
  if (Array.isArray(msg.content)) {
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && block.id) ids.push(block.id as string);
    }
  }
  return ids;
}

export function hasToolResults(msg: Record<string, unknown>, toolCallIds: string[]): boolean {
  if (!msg || !toolCallIds.length) return false;
  if (msg.role === 'tool' && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id as string);
  }
  if (msg.role === 'user' && Array.isArray(msg.content)) {
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_result' && toolCallIds.includes(block.tool_use_id as string)) return true;
    }
  }
  return false;
}

export function fixMissingToolResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages;
  if (!messages || !Array.isArray(messages)) return body;

  const newMessages: unknown[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    const nextMsg = messages[i + 1] as Record<string, unknown> | undefined;
    newMessages.push(msg);

    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length === 0) continue;

    if (nextMsg && !hasToolResults(nextMsg, toolCallIds)) {
      for (const id of toolCallIds) {
        newMessages.push({ role: 'tool', tool_call_id: id, content: '' });
      }
    }
  }

  body.messages = newMessages;
  return body;
}
