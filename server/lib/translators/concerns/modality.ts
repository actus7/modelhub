// Modality stripping — simplified for ModelHub port.
// Removes media blocks a model cannot read, BEFORE translation.
import { FORMATS } from '../formats.js';

const PLACEHOLDER_CURRENT: Record<string, string> = {
  vision: '[image omitted: model has no vision support]',
  audioInput: '[audio omitted: model has no audio support]',
  pdf: '[file omitted: model has no document support]',
};

function capForOpenAIBlock(block: Record<string, unknown>): string | null {
  const t = block?.type;
  if (t === 'image_url' || t === 'image') return 'vision';
  if (t === 'input_audio' || t === 'audio_url') return 'audioInput';
  if (t === 'file') return 'pdf';
  return null;
}

function filterBlocks(
  blocks: Array<Record<string, unknown>>,
  capOf: (b: Record<string, unknown>) => string | null,
  caps: Record<string, boolean>,
  removed: Set<string>,
  isLast: boolean,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) { removed.add(cap); continue; }
    out.push(block);
  }
  for (const cap of removed) {
    out.push({ type: 'text', text: isLast ? PLACEHOLDER_CURRENT[cap] || `[${cap} omitted]` : `[Previous ${cap} omitted from context.]` });
  }
  return out;
}

function stripOpenAI(body: Record<string, unknown>, caps: Record<string, boolean>): void {
  const messages = body.messages;
  if (!Array.isArray(messages)) return;
  const last = messages.length - 1;
  messages.forEach((msg: Record<string, unknown>, i: number) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set<string>();
    msg.content = filterBlocks(msg.content as Array<Record<string, unknown>>, capForOpenAIBlock, caps, removed, i === last);
  });
}

export function stripUnsupportedModalities(
  body: Record<string, unknown>,
  sourceFormat: string,
  caps: Record<string, boolean>,
): boolean {
  if (!body || !caps) return false;
  if (caps.vision !== false && caps.audioInput !== false && caps.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      stripOpenAI(body, caps);
      break;
    default:
      stripOpenAI(body, caps);
  }
  return true;
}
