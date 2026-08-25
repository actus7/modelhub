// OpenAI to Cursor request translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from '../schema/index.js';
import { DEFAULT_MIN_TOKENS } from '../schema/defaults.js';

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter(part => part && typeof part === 'object' && part.type === OPENAI_BLOCK.TEXT && typeof part.text === 'string')
      .map(part => (part.text as string) || '')
      .join('');
  }
  return '';
}

function sanitizeToolResultText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildToolResultBlock(toolName: string, toolCallId: string, resultText: string): string {
  const cleanResult = sanitizeToolResultText(resultText || '');
  return ['<tool_result>', `<tool_name>${escapeXml(toolName || 'tool')}</tool_name>`, `<tool_call_id>${escapeXml(toolCallId || '')}</tool_call_id>`, `<result>${escapeXml(cleanResult)}</result>`, '</tool_result>'].join('\n');
}

function convertMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Record<string, unknown>[] = [];
  const toolCallMetaMap = new Map<string, { name: string }>();

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const id = tc.id as string || '';
        if (id) toolCallMetaMap.set(id, { name: (tc.function as Record<string, unknown>)?.name as string || 'tool' });
      }
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (part?.type !== CLAUDE_BLOCK.TOOL_USE) continue;
        const id = part.id as string || '';
        if (id) toolCallMetaMap.set(id, { name: part.name as string || 'tool' });
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM) {
      result.push({ role: ROLE.USER, content: `[System Instructions]\n${extractContent(msg.content)}` });
      continue;
    }
    if (msg.role === ROLE.TOOL) {
      const toolContent = extractContent(msg.content);
      const toolCallId = msg.tool_call_id as string || '';
      const toolMeta = toolCallMetaMap.get(toolCallId) || { name: '' };
      const toolName = (msg.name as string) || toolMeta.name || 'tool';
      result.push({ role: ROLE.USER, content: buildToolResultBlock(toolName, toolCallId, toolContent) });
      continue;
    }
    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.USER && Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === CLAUDE_BLOCK.TEXT) { if (typeof block.text === 'string') parts.push(block.text || ''); continue; }
          if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            const tcId = block.tool_use_id as string || '';
            const toolMeta = toolCallMetaMap.get(tcId);
            const toolName = toolMeta?.name || 'tool';
            parts.push(buildToolResultBlock(toolName, tcId, extractContent(block.content)));
          }
        }
        const joined = parts.filter(Boolean).join('\n');
        if (joined) result.push({ role: ROLE.USER, content: joined });
        continue;
      }
      const content = extractContent(msg.content);
      if (msg.role === ROLE.ASSISTANT && msg.tool_calls && Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0) {
        const assistantMsg: Record<string, unknown> = { role: ROLE.ASSISTANT, content: content || '' };
        assistantMsg.tool_calls = (msg.tool_calls as Array<Record<string, unknown>>).map(tc => { const { index: _idx, ...rest } = tc; return rest; });
        result.push(assistantMsg);
      } else if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
        const extractedToolCalls = (msg.content as Array<Record<string, unknown>>)
          .filter(b => b?.type === CLAUDE_BLOCK.TOOL_USE)
          .map(b => ({ id: b.id || '', type: OPENAI_BLOCK.FUNCTION, function: { name: b.name || 'tool', arguments: JSON.stringify(b.input || {}) } }))
          .filter(tc => tc.id);
        if (extractedToolCalls.length > 0) result.push({ role: ROLE.ASSISTANT, content: content || '', tool_calls: extractedToolCalls });
        else if (content) result.push({ role: ROLE.ASSISTANT, content });
      } else if (content) {
        result.push({ role: msg.role, content });
      }
    }
  }
  return result;
}

export function openaiToCursorRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const messages = convertMessages(body.messages as Array<Record<string, unknown>>);
  const { user: _user, metadata: _metadata, tool_choice: _tc, stream_options: _so, system: _sys, ...rest } = body;
  return { ...rest, messages, max_tokens: DEFAULT_MIN_TOKENS };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, openaiToCursorRequest, null);
