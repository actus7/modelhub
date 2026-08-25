import { ROLE } from '../schema/index.js';

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text: string, withRole = false): Record<string, unknown> {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes.
export function extractReasoningText(delta: Record<string, unknown> | undefined): string {
  if (!delta || typeof delta !== 'object') return '';
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === 'string' && delta.reasoning) return delta.reasoning;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d: unknown) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') return (d as Record<string, unknown>).text || (d as Record<string, unknown>).content || '';
      return '';
    }).join('');
  }
  return '';
}
