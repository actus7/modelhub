import { OPENAI_BLOCK } from '../schema/index.js';

// Collapse an OpenAI content-part array: a lone text part becomes a plain string,
// otherwise the array is returned as-is.
export function collapseTextParts(parts: Array<Record<string, unknown>>): string | Array<Record<string, unknown>> {
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT
    ? (parts[0].text as string)
    : parts;
}
