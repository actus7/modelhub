// Claude helper functions for translator — simplified for ModelHub port.
import { ROLE, CLAUDE_BLOCK } from '../schema/index.js';
import { DEFAULT_MAX_TOKENS } from '../schema/defaults.js';

export function hasValidContent(msg: Record<string, unknown>): boolean {
  if (typeof msg.content === 'string' && msg.content.trim()) return true;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<Record<string, unknown>>).some(block =>
      (block.type === CLAUDE_BLOCK.TEXT && (block.text as string)?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT,
    );
  }
  return false;
}

export function fixToolUseOrdering(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (messages.length <= 1) return messages;

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = (msg.content as Array<Record<string, unknown>>).some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        const newContent: Record<string, unknown>[] = [];
        let foundToolUse = false;
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            newContent.push(block);
          }
        }
        msg.content = newContent;
      }
    }
  }

  const merged: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content as Array<Record<string, unknown>> : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content as Array<Record<string, unknown>> : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];
      last.content = [...toolResults, ...otherContent];
    } else {
      const content = Array.isArray(msg.content) ? msg.content as Array<Record<string, unknown>> : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }
  return merged;
}

export function prepareClaudeRequest(
  body: Record<string, unknown>,
  _provider: string | null = null,
  _apiKey: string | null = null,
  _connectionId: string | null = null,
  _rawHeaders: unknown = null,
  _sessionId: string | null = null,
): Record<string, unknown> {
  if (body.max_tokens) {
    const ceiling = DEFAULT_MAX_TOKENS;
    if ((body.max_tokens as number) > ceiling) body.max_tokens = ceiling;
    const thinking = body.thinking as Record<string, unknown> | undefined;
    if (thinking?.type === 'enabled' && thinking.budget_tokens && (thinking.budget_tokens as number) >= (body.max_tokens as number)) {
      body.max_tokens = Math.min((thinking.budget_tokens as number) + 1024, ceiling);
      if ((thinking.budget_tokens as number) >= (body.max_tokens as number)) {
        thinking.budget_tokens = Math.max(1024, (body.max_tokens as number) - 1024);
      }
    }
  }

  if (body.system && Array.isArray(body.system)) {
    body.system = (body.system as Array<Record<string, unknown>>).map((block, i, arr) => {
      const { cache_control: _cc, ...rest } = block;
      if (i === arr.length - 1) return { ...rest, cache_control: { type: 'ephemeral', ttl: '1h' } };
      return rest;
    });
  }

  if (body.messages && Array.isArray(body.messages)) {
    const len = (body.messages as unknown[]).length;
    let filtered: Array<Record<string, unknown>> = [];

    for (let i = 0; i < len; i++) {
      const msg = (body.messages as Array<Record<string, unknown>>)[i];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          delete block.cache_control;
        }
      }
      const isFinalAssistant = i === len - 1 && msg.role === 'assistant';
      if (isFinalAssistant || hasValidContent(msg)) filtered.push(msg);
    }

    filtered = fixToolUseOrdering(filtered);
    body.messages = filtered;

    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === 'user';
    const thinkingEnabled = (body.thinking as Record<string, unknown>)?.type === 'enabled' && lastMessageIsUser;

    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        if (!lastAssistantProcessed && (msg.content as unknown[]).length > 0) {
          for (let j = (msg.content as unknown[]).length - 1; j >= 0; j--) {
            const block = (msg.content as Array<Record<string, unknown>>)[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: 'ephemeral' };
              break;
            }
          }
          lastAssistantProcessed = true;
        }
        if (thinkingEnabled) {
          const hasToolUse = (msg.content as Array<Record<string, unknown>>).some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
          const hasKeptThinking = (msg.content as Array<Record<string, unknown>>).some(b => b.type === CLAUDE_BLOCK.THINKING || b.type === CLAUDE_BLOCK.REDACTED_THINKING);
          if (hasToolUse && !hasKeptThinking) {
            (msg.content as Array<Record<string, unknown>>).unshift({ type: CLAUDE_BLOCK.THINKING, thinking: '.', signature: 'default' });
          }
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools)) {
    body.tools = (body.tools as Array<Record<string, unknown>>).map((tool, i, arr) => {
      const { cache_control: _cc, ...rest } = tool;
      if (i === arr.length - 1) return { ...rest, cache_control: { type: 'ephemeral', ttl: '1h' } };
      return rest;
    });
    if ((body.tools as unknown[]).length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  return body;
}
