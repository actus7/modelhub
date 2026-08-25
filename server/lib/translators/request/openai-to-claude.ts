// Convert OpenAI request to Claude format
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { adjustMaxTokens } from '../formats/maxTokens.js';
import { safeParseJSON } from '../concerns/json.js';
import { parseDataUri } from '../concerns/image.js';
import { extractTextContent } from '../formats/gemini.js';
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from '../schema/index.js';

export function openaiToClaudeRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const toolNameMap = new Map<string, string>();
  const result: Record<string, unknown> = {
    model,
    max_tokens: adjustMaxTokens(body),
    stream,
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;

  result.messages = [];
  const systemParts: string[] = [];

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      if (msg.role === ROLE.SYSTEM) {
        systemParts.push(typeof msg.content === 'string' ? msg.content : extractTextContent(msg.content, '\n'));
      }
    }

    const nonSystemMessages = (body.messages as Array<Record<string, unknown>>).filter(m => m.role !== ROLE.SYSTEM);
    let currentRole: string | undefined = undefined;
    let currentParts: Record<string, unknown>[] = [];

    const flushCurrentMessage = () => {
      if (currentRole && currentParts.length > 0) {
        (result.messages as unknown[]).push({ role: currentRole, content: currentParts });
        currentParts = [];
      }
    };

    for (const msg of nonSystemMessages) {
      const newRole = (msg.role === ROLE.USER || msg.role === ROLE.TOOL) ? ROLE.USER : ROLE.ASSISTANT;
      const blocks = getContentBlocksFromMessage(msg, toolNameMap);
      const hasToolUse = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      const hasToolResult = blocks.some(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);

      if (hasToolResult) {
        const toolResultBlocks = blocks.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT);
        const otherBlocks = blocks.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT);
        flushCurrentMessage();
        if (toolResultBlocks.length > 0) (result.messages as unknown[]).push({ role: ROLE.USER, content: toolResultBlocks });
        if (otherBlocks.length > 0) { currentRole = newRole; currentParts.push(...otherBlocks); }
        continue;
      }

      if (currentRole !== newRole) { flushCurrentMessage(); currentRole = newRole; }
      currentParts.push(...blocks);
      if (hasToolUse) flushCurrentMessage();
    }
    flushCurrentMessage();

    for (let i = (result.messages as unknown[]).length - 1; i >= 0; i--) {
      const message = (result.messages as Array<Record<string, unknown>>)[i];
      if (message.role === ROLE.ASSISTANT && Array.isArray(message.content) && (message.content as unknown[]).length > 0) {
        for (let j = (message.content as unknown[]).length - 1; j >= 0; j--) {
          const block = (message.content as Array<Record<string, unknown>>)[j];
          if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
            block.cache_control = { type: 'ephemeral' };
            break;
          }
        }
        break;
      }
    }
  }

  if (body.response_format) {
    const rf = body.response_format as Record<string, unknown>;
    if (rf.type === 'json_schema' && (rf.json_schema as Record<string, unknown>)?.schema) {
      const schemaJson = JSON.stringify((rf.json_schema as Record<string, unknown>).schema, null, 2);
      systemParts.push(`You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`);
    } else if (rf.type === 'json_object') {
      systemParts.push('You must respond with valid JSON. Respond ONLY with a JSON object, no other text.');
    }
  }

  if (systemParts.length > 0) {
    result.system = [{ type: CLAUDE_BLOCK.TEXT, text: systemParts.join('\n'), cache_control: { type: 'ephemeral', ttl: '1h' } }];
  }

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      const toolType = tool.type;
      if (toolType && toolType !== OPENAI_BLOCK.FUNCTION) {
        (result.tools as unknown[]).push(tool);
        continue;
      }
      const toolData = (tool.function as Record<string, unknown>) ?? tool;
      const originalName = toolData.name as string;
      const toolName = originalName;
      toolNameMap.set(toolName, originalName);
      (result.tools as unknown[]).push({
        name: toolName,
        description: toolData.description || '',
        input_schema: toolData.parameters || toolData.input_schema || { type: 'object', properties: {}, required: [] },
      });
    }
    if ((result.tools as unknown[]).length > 0) {
      (result.tools as Array<Record<string, unknown>>)[(result.tools as unknown[]).length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
    }
  }

  if (body.tool_choice) result.tool_choice = convertOpenAIToolChoice(body.tool_choice as Record<string, unknown> | string);
  if (toolNameMap.size > 0) result._toolNameMap = toolNameMap;

  return result;
}

function getContentBlocksFromMessage(msg: Record<string, unknown>, _toolNameMap: Map<string, string> = new Map()): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];

  if (msg.role === ROLE.TOOL) {
    blocks.push({ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: msg.tool_call_id, content: msg.content });
  } else if (msg.role === ROLE.USER) {
    if (typeof msg.content === 'string') {
      if (msg.content) blocks.push({ type: CLAUDE_BLOCK.TEXT, text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_RESULT) {
          blocks.push({ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: part.tool_use_id, content: part.content, ...(part.is_error ? { is_error: part.is_error } : {}) });
        } else if (part.type === OPENAI_BLOCK.IMAGE_URL) {
          const url = ((part.image_url as Record<string, unknown>)?.url || part.image_url) as string;
          const parsed = parseDataUri(url);
          if (parsed) {
            blocks.push({ type: CLAUDE_BLOCK.IMAGE, source: { type: 'base64', media_type: parsed.mimeType, data: parsed.base64 } });
          } else if (url.startsWith('http://') || url.startsWith('https://')) {
            blocks.push({ type: CLAUDE_BLOCK.IMAGE, source: { type: 'url', url } });
          }
        } else if (part.type === OPENAI_BLOCK.FILE && part.file) {
          const fileData = (part.file as Record<string, unknown>).file_data as string;
          const parsed = parseDataUri(fileData);
          if (parsed && parsed.mimeType === 'application/pdf') {
            blocks.push({ type: CLAUDE_BLOCK.DOCUMENT, source: { type: 'base64', media_type: parsed.mimeType, data: parsed.base64 } });
          }
        }
      }
    }
  } else if (msg.role === ROLE.ASSISTANT) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (part.type === OPENAI_BLOCK.TEXT && part.text) {
          blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
        } else if (part.type === CLAUDE_BLOCK.TOOL_USE) {
          blocks.push({ type: CLAUDE_BLOCK.TOOL_USE, id: part.id, name: part.name, input: part.input });
        } else if (part.type === CLAUDE_BLOCK.THINKING) {
          const { cache_control: _cc, ...thinkingBlock } = part;
          blocks.push(thinkingBlock);
        }
      }
    } else if (msg.content) {
      const text = typeof msg.content === 'string' ? msg.content : extractTextContent(msg.content, '\n');
      if (text) blocks.push({ type: CLAUDE_BLOCK.TEXT, text });
    }
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        if (tc.type === OPENAI_BLOCK.FUNCTION) {
          const fn = tc.function as Record<string, unknown>;
          blocks.push({
            type: CLAUDE_BLOCK.TOOL_USE,
            id: tc.id,
            name: fn.name,
            input: safeParseJSON(fn.arguments, fn.arguments),
          });
        }
      }
    }
  }
  return blocks;
}

const CLAUDE_TOOL_CHOICE_TYPES = new Set(['auto', 'any', 'tool', 'none']);

function convertOpenAIToolChoice(choice: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!choice) return { type: 'auto' };
  if (typeof choice === 'string') {
    if (choice === 'required') return { type: 'any' };
    return { type: 'auto' };
  }
  if (typeof choice === 'object') {
    if ((choice.function as Record<string, unknown>)?.name) return { type: 'tool', name: (choice.function as Record<string, unknown>).name };
    if (CLAUDE_TOOL_CHOICE_TYPES.has(choice.type as string)) return choice;
  }
  return { type: 'auto' };
}

register(FORMATS.OPENAI, FORMATS.CLAUDE, openaiToClaudeRequest, null);
