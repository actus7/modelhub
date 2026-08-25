// Claude to Kiro request translator — simplified for ModelHub port.
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { randomUUID } from 'crypto';
import { DEFAULT_IMAGE_MIME } from '../schema/defaults.js';
import { ROLE, CLAUDE_BLOCK } from '../schema/index.js';
import { canonicalizeKiroConversation, normalizeKiroToolSpecs } from '../concerns/kiroConversation.js';

function convertClaudeMessagesToKiro(messages: Array<Record<string, unknown>>, model: string): { history: unknown[]; currentMessage: unknown } {
  const history: Record<string, unknown>[] = [];
  let currentMessage: Record<string, unknown> | null = null;
  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];
  let pendingImages: Record<string, unknown>[] = [];
  let currentRole: string | null = null;

  const flushPending = () => {
    if (currentRole === ROLE.USER) {
      const content = pendingUserContent.join('\n\n').trim() || 'continue';
      const userMsg: Record<string, unknown> = { userInputMessage: { content, modelId: model } };
      if (pendingImages.length > 0) (userMsg.userInputMessage as Record<string, unknown>).images = pendingImages;
      if (pendingToolResults.length > 0) (userMsg.userInputMessage as Record<string, unknown>).userInputMessageContext = { toolResults: pendingToolResults };
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = []; pendingToolResults = []; pendingImages = [];
    } else if (currentRole === ROLE.ASSISTANT) {
      const content = pendingAssistantContent.join('\n\n').trim() || '...';
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (const msg of messages) {
    const role = msg.role as string;
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === ROLE.USER) {
      if (typeof msg.content === 'string') pendingUserContent.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === CLAUDE_BLOCK.TEXT) pendingUserContent.push(block.text as string);
          else if (block.type === CLAUDE_BLOCK.IMAGE && (block.source as Record<string, unknown>)?.type === 'base64') {
            const src = block.source as Record<string, unknown>;
            const mediaType = (src.media_type as string) || DEFAULT_IMAGE_MIME;
            pendingImages.push({ format: mediaType.split('/')[1] || mediaType, source: { bytes: src.data } });
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let resultContent = '';
            if (typeof block.content === 'string') resultContent = block.content;
            else if (Array.isArray(block.content)) resultContent = (block.content as Array<Record<string, unknown>>).filter(c => c.type === CLAUDE_BLOCK.TEXT).map(c => c.text as string).join('\n') || JSON.stringify(block.content);
            else if (block.content) resultContent = JSON.stringify(block.content);
            pendingToolResults.push({ toolUseId: block.tool_use_id, status: block.is_error ? 'error' : 'success', content: [{ text: resultContent }] });
          }
        }
      }
    } else if (role === ROLE.ASSISTANT) {
      let textContent = '';
      const toolUses: Record<string, unknown>[] = [];
      if (typeof msg.content === 'string') textContent = msg.content;
      else if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === CLAUDE_BLOCK.TEXT) textContent += block.text;
          else if (block.type === CLAUDE_BLOCK.TOOL_USE) toolUses.push({ toolUseId: block.id, name: block.name, input: block.input || {} });
        }
      }
      if (textContent) pendingAssistantContent.push(textContent);
      if (toolUses.length > 0) {
        flushPending();
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) (lastMsg.assistantResponseMessage as Record<string, unknown>).toolUses = toolUses;
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

export function claudeToKiroRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> | null {
  const messages = (body.messages || []) as Array<Record<string, unknown>>;
  const tools = (body.tools || []) as unknown[];
  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertClaudeMessagesToKiro(messages, model);

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

register(FORMATS.CLAUDE, FORMATS.KIRO, claudeToKiroRequest, null);
