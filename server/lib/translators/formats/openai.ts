// OpenAI helper functions for translator
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES } from '../schema/index.js';

export { VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES };

// Filter messages to OpenAI standard format
export function filterToOpenAIFormat(body: Record<string, unknown>, opts: { preserveCacheControl?: boolean } = {}): Record<string, unknown> {
  const messages = body.messages;
  if (!messages || !Array.isArray(messages)) return body;
  const keepCache = !!opts.preserveCacheControl;

  function stripBlock(block: Record<string, unknown>): Record<string, unknown> {
    const { signature: _sig, cache_control, ...rest } = block;
    return keepCache && cache_control ? { ...rest, cache_control } : rest;
  }

  body.messages = messages.map((msg: Record<string, unknown>) => {
    if (msg.role === ROLE.DEVELOPER) msg = { ...msg, role: ROLE.SYSTEM };
    if (msg.role === ROLE.TOOL) return msg;
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) return msg;
    if (typeof msg.content === 'string') return msg;

    if (Array.isArray(msg.content)) {
      const filteredContent: Record<string, unknown>[] = [];
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
        if ((VALID_OPENAI_CONTENT_TYPES as readonly string[]).includes(block.type as string)) {
          filteredContent.push(stripBlock(block));
        } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
          continue;
        } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
          filteredContent.push(stripBlock(block));
        }
      }
      if (filteredContent.length === 0) {
        filteredContent.push({ type: OPENAI_BLOCK.TEXT, text: '' });
      }
      return { ...msg, content: filteredContent };
    }
    return msg;
  });

  body.messages = (body.messages as Array<Record<string, unknown>>).filter((msg: Record<string, unknown>) => {
    if (msg.role === ROLE.TOOL) return true;
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) return true;
    if (typeof msg.content === 'string') return msg.content.trim() !== '';
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<Record<string, unknown>>).some(b =>
        (b.type === OPENAI_BLOCK.TEXT && (b.text as string)?.trim()) || b.type !== OPENAI_BLOCK.TEXT,
      );
    }
    return true;
  });

  const tools = body.tools;
  if (tools && Array.isArray(tools) && tools.length === 0) {
    delete body.tools;
  }

  if (tools && Array.isArray(tools) && tools.length > 0) {
    body.tools = (tools as Array<Record<string, unknown>>).map((tool: Record<string, unknown>) => {
      if (tool.type === OPENAI_BLOCK.FUNCTION && tool.function) return tool;
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: tool.name,
            description: String(tool.description || ''),
            parameters: tool.input_schema || { type: 'object', properties: {} },
          },
        };
      }
      return tool;
    }).flat();
  }

  if (body.tool_choice && typeof body.tool_choice === 'object') {
    const choice = body.tool_choice as Record<string, unknown>;
    if (choice.type === 'auto') body.tool_choice = 'auto';
    else if (choice.type === 'any') body.tool_choice = 'required';
    else if (choice.type === 'tool' && choice.name) {
      body.tool_choice = { type: OPENAI_BLOCK.FUNCTION, function: { name: choice.name } };
    }
  }

  return body;
}
