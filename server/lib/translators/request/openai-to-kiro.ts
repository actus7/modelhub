// OpenAI to Kiro request translator — simplified for ModelHub port.
// Preserves the core conversion logic without external session/kiro dependencies.
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { randomUUID } from 'crypto';
import { parseDataUri } from '../concerns/image.js';
import { DEFAULT_IMAGE_MIME } from '../schema/defaults.js';
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from '../schema/index.js';
import { canonicalizeKiroConversation, normalizeKiroToolSpecs } from '../concerns/kiroConversation.js';

function safeJSONParse(str: unknown, fallback: unknown): unknown {
  if (typeof str !== 'string') return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function convertMessages(messages: Array<Record<string, unknown>>, model: string): { history: unknown[]; currentMessage: unknown } {
  let history: Record<string, unknown>[] = [];
  let currentMessage: Record<string, unknown> | null = null;
  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];
  let pendingImages: Record<string, unknown>[] = [];
  let currentRole: string | null = null;

  const flushPending = () => {
    if (currentRole === 'user') {
      const content = pendingUserContent.join('\n\n').trim() || 'continue';
      const userMsg: Record<string, unknown> = { userInputMessage: { content, modelId: '' } };
      if (pendingImages.length > 0) (userMsg.userInputMessage as Record<string, unknown>).images = pendingImages;
      if (pendingToolResults.length > 0) (userMsg.userInputMessage as Record<string, unknown>).userInputMessageContext = { toolResults: pendingToolResults };
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = []; pendingToolResults = []; pendingImages = [];
    } else if (currentRole === 'assistant') {
      const content = pendingAssistantContent.join('\n\n').trim() || '...';
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (const msg of messages) {
    let role = msg.role as string;
    const wasSystem = role === ROLE.SYSTEM;
    if (role === ROLE.SYSTEM || role === ROLE.TOOL) role = ROLE.USER;
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === ROLE.USER) {
      let content = '';
      if (typeof msg.content === 'string') content = msg.content;
      else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const c of msg.content as Array<Record<string, unknown>>) {
          if (c.type === OPENAI_BLOCK.TEXT || c.text) textParts.push((c.text as string) || '');
          else if (c.type === OPENAI_BLOCK.IMAGE_URL) {
            const url = ((c.image_url as Record<string, unknown>)?.url || '') as string;
            const parsed = parseDataUri(url);
            if (parsed) {
              const format = parsed.mimeType.split('/')[1] || parsed.mimeType;
              pendingImages.push({ format, source: { bytes: parsed.base64 } });
            } else if (url.startsWith('http://') || url.startsWith('https://')) textParts.push(`[Image: ${url}]`);
          }
        }
        content = textParts.join('\n');
        const toolResultBlocks = (msg.content as Array<Record<string, unknown>>).filter(c => c.type === CLAUDE_BLOCK.TOOL_RESULT);
        for (const block of toolResultBlocks) {
          const text = Array.isArray(block.content)
            ? (block.content as Array<Record<string, unknown>>).map(c => (c.text as string) || '').join('\n')
            : (typeof block.content === 'string' ? block.content : '');
          pendingToolResults.push({ toolUseId: block.tool_use_id, status: block.is_error ? 'error' : 'success', content: [{ text }] });
        }
      }
      if (msg.role === ROLE.TOOL) {
        const toolContent = typeof msg.content === 'string' ? msg.content : '';
        pendingToolResults.push({ toolUseId: msg.tool_call_id, status: 'success', content: [{ text: toolContent }] });
      } else if (content) {
        pendingUserContent.push(wasSystem ? `<instructions>\n${content}\n</instructions>` : content);
      }
    } else if (role === ROLE.ASSISTANT) {
      let textContent = '';
      let toolUses: Record<string, unknown>[] = [];
      if (Array.isArray(msg.content)) {
        textContent = (msg.content as Array<Record<string, unknown>>).filter(c => c.type === OPENAI_BLOCK.TEXT).map(b => b.text as string).join('\n').trim();
        toolUses = (msg.content as Array<Record<string, unknown>>).filter(c => c.type === CLAUDE_BLOCK.TOOL_USE);
      } else if (typeof msg.content === 'string') textContent = msg.content.trim();
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0) toolUses = msg.tool_calls as unknown as Record<string, unknown>[];
      if (textContent) pendingAssistantContent.push(textContent);
      if (toolUses.length > 0) {
        flushPending();
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          (lastMsg.assistantResponseMessage as Record<string, unknown>).toolUses = toolUses.map(tc => {
            if (tc.function) return { toolUseId: tc.id || randomUUID(), name: (tc.function as Record<string, unknown>).name, input: safeJSONParse((tc.function as Record<string,unknown>).arguments, {}) };
            return { toolUseId: tc.id || randomUUID(), name: tc.name, input: tc.input || {} };
          });
        }
        currentRole = null;
      }
    }
  }

  if (currentRole !== null) flushPending();

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) { currentMessage = history.splice(i, 1)[0]; break; }
  }

  history.forEach(item => {
    const um = item.userInputMessage as Record<string, unknown> | undefined;
    if (um?.userInputMessageContext && Object.keys(um.userInputMessageContext as object).length === 0) delete um.userInputMessageContext;
    if (um && !um.modelId) um.modelId = model;
  });

  const mergedHistory: Record<string, unknown>[] = [];
  for (const current of history) {
    const prev = mergedHistory[mergedHistory.length - 1];
    if (current.userInputMessage && prev?.userInputMessage) {
      (prev.userInputMessage as Record<string, unknown>).content += '\n\n' + (current.userInputMessage as Record<string, unknown>).content;
    } else mergedHistory.push(current);
  }

  if (!currentMessage) currentMessage = { userInputMessage: { content: '', modelId: model } };
  return { history: mergedHistory, currentMessage };
}

export function openaiToKiroRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> | null {
  const messages = (body.messages || []) as Array<Record<string, unknown>>;
  const tools = (body.tools || []) as unknown[];
  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertMessages(messages, model);

  const canonical = canonicalizeKiroConversation({ history, currentMessage, modelId: model, toolSpecs, nameMap });
  if (!canonical.valid) return null;

  const replayCurrent = canonical.currentMessage as Record<string, unknown>;
  const um = replayCurrent.userInputMessage as Record<string, unknown>;

  return {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: randomUUID(),
      agentContinuationId: randomUUID(),
      agentTaskType: 'vibe',
      currentMessage: { userInputMessage: { content: (um.content as string) || '', modelId: model, origin: 'AI_EDITOR' } },
      history: canonical.history,
    },
    agentMode: 'vibe',
  };
}

register(FORMATS.OPENAI, FORMATS.KIRO, openaiToKiroRequest, null);
