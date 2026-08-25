// Convert Claude request to OpenAI format
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { adjustMaxTokens } from '../formats/maxTokens.js';
import { encodeDataUri } from '../concerns/image.js';
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from '../schema/index.js';
import { collapseTextParts } from '../concerns/message.js';

function stripAnthropicBillingHeader(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/^x-anthropic-billing-header:[^\n]*(?:\r?\n)?/i, '');
}

export function claudeToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = { model, messages: [], stream };

  if (body.max_tokens) result.max_tokens = adjustMaxTokens(body);
  if (body.temperature !== undefined) result.temperature = body.temperature;

  if (body.system) {
    const systemContent = Array.isArray(body.system)
      ? (body.system as Array<Record<string, unknown>>).map(s => stripAnthropicBillingHeader(s.text)).filter(Boolean).join('\n')
      : stripAnthropicBillingHeader(body.system);
    if (systemContent) (result.messages as unknown[]).push({ role: ROLE.SYSTEM, content: systemContent });
  }

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      const converted = convertClaudeMessage(msg);
      if (converted) {
        if (Array.isArray(converted)) (result.messages as unknown[]).push(...converted);
        else (result.messages as unknown[]).push(converted);
      }
    }
  }

  fixMissingToolResponsesOpenAI(result.messages as Array<Record<string, unknown>>);

  if (body.tools && Array.isArray(body.tools)) {
    result.tools = (body.tools as Array<Record<string, unknown>>).map(tool => ({
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: tool.name,
        description: String(tool.description || ''),
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }));
  }

  if (body.tool_choice) result.tool_choice = convertToolChoice(body.tool_choice as Record<string, unknown> | string);
  if (body.reasoning_effort !== undefined) result.reasoning_effort = body.reasoning_effort;

  return result;
}

function fixMissingToolResponsesOpenAI(messages: Array<Record<string, unknown>>): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls && Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0) {
      const toolCallIds = (msg.tool_calls as Array<Record<string, unknown>>).map(tc => tc.id as string);
      const respondedIds = new Set<string>();
      let insertPosition = i + 1;
      for (let j = i + 1; j < messages.length; j++) {
        const nextMsg = messages[j];
        if (nextMsg.role === ROLE.TOOL && nextMsg.tool_call_id) {
          respondedIds.add(nextMsg.tool_call_id as string);
          insertPosition = j + 1;
        } else break;
      }
      const missingIds = toolCallIds.filter(id => !respondedIds.has(id));
      if (missingIds.length > 0) {
        const missingResponses = missingIds.map(id => ({ role: ROLE.TOOL, tool_call_id: id, content: '[No response received]' }));
        messages.splice(insertPosition, 0, ...missingResponses);
        i = insertPosition + missingResponses.length - 1;
      }
    }
  }
}

function convertClaudeMessage(msg: Record<string, unknown>): Record<string, unknown> | Record<string, unknown>[] | null {
  if (msg.role === ROLE.SYSTEM) {
    const parts = Array.isArray(msg.content)
      ? (msg.content as Array<Record<string, unknown>>).filter(c => c?.type === CLAUDE_BLOCK.TEXT).map(c => (c.text as string) || '')
      : [typeof msg.content === 'string' ? msg.content : ''];
    const text = parts.filter(Boolean).join('\n');
    return text ? { role: ROLE.USER, content: `<instructions>\n${text}\n</instructions>` } : null;
  }

  const role = msg.role === ROLE.USER || msg.role === ROLE.TOOL ? ROLE.USER : ROLE.ASSISTANT;

  if (typeof msg.content === 'string') return { role, content: msg.content };

  if (Array.isArray(msg.content)) {
    const parts: Record<string, unknown>[] = [];
    const toolCalls: Record<string, unknown>[] = [];
    const toolResults: Record<string, unknown>[] = [];

    for (const block of msg.content as Array<Record<string, unknown>>) {
      switch (block.type) {
        case CLAUDE_BLOCK.TEXT:
          parts.push({ type: OPENAI_BLOCK.TEXT, text: block.text });
          break;
        case CLAUDE_BLOCK.IMAGE:
          if ((block.source as Record<string, unknown>)?.type === 'base64') {
            const src = block.source as Record<string, unknown>;
            parts.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: encodeDataUri(src.media_type as string, src.data as string) } });
          }
          break;
        case CLAUDE_BLOCK.TOOL_USE:
          toolCalls.push({
            id: block.id,
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
          });
          break;
        case CLAUDE_BLOCK.TOOL_RESULT: {
          let resultContent = '';
          if (typeof block.content === 'string') resultContent = block.content;
          else if (Array.isArray(block.content)) {
            resultContent = (block.content as Array<Record<string, unknown>>)
              .filter(c => c.type === CLAUDE_BLOCK.TEXT).map(c => c.text as string).join('\n') || JSON.stringify(block.content);
          } else if (block.content) resultContent = JSON.stringify(block.content);
          toolResults.push({ role: ROLE.TOOL, tool_call_id: block.tool_use_id, content: resultContent });
          break;
        }
      }
    }

    if (toolResults.length > 0) {
      if (parts.length > 0) return [...toolResults, { role: ROLE.USER, content: collapseTextParts(parts) }];
      return toolResults;
    }
    if (toolCalls.length > 0) {
      const result: Record<string, unknown> = { role: ROLE.ASSISTANT };
      if (parts.length > 0) result.content = collapseTextParts(parts);
      result.tool_calls = toolCalls;
      return result;
    }
    if (parts.length > 0) return { role, content: collapseTextParts(parts) };
    if ((msg.content as unknown[]).length === 0) return { role, content: '' };
  }
  return null;
}

function convertToolChoice(choice: Record<string, unknown> | string | null): string | Record<string, unknown> {
  if (!choice) return 'auto';
  if (typeof choice === 'string') return choice;
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'tool': return { type: OPENAI_BLOCK.FUNCTION, function: { name: choice.name } };
    default: return 'auto';
  }
}

register(FORMATS.CLAUDE, FORMATS.OPENAI, claudeToOpenAIRequest, null);
