// Translator engine — self-registering pattern ported from 9router.
// All translator modules call register() at import time (side-effect).

import { FORMATS, detectFormatByEndpoint } from './formats.js';
import { ensureToolCallIds, fixMissingToolResponses } from './concerns/toolCall.js';
import { applyThinking, captureThinking } from './concerns/thinkingUnified.js';
import {
  requestRegistry,
  responseRegistry,
  registerTranslator,
  type RequestTranslatorFn,
  type ResponseTranslatorFn,
} from './registry.js';

// Re-export types and registry functions
export type { RequestTranslatorFn, ResponseTranslatorFn } from './registry.js';
export { FORMATS, detectFormatByEndpoint } from './formats.js';

// Register function (delegates to registry)
export const register = registerTranslator;

// Translate request: source -> openai -> target
export function translateRequest(
  sourceFormat: string,
  targetFormat: string,
  model: string,
  body: Record<string, unknown>,
  stream = true,
  credentials: unknown = null,
): Record<string, unknown> {
  let result = body;

  // Always ensure tool_calls have id
  ensureToolCallIds(result);

  // Kiro performs stricter source-aware reconciliation after session replay.
  if (targetFormat !== FORMATS.KIRO) {
    fixMissingToolResponses(result);
  }

  // Capture thinking intent from the original body
  const thinkingIntent = captureThinking(result);

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Direct route: if a translator is registered for this exact source:target pair
    const directFn = requestRegistry.get(`${sourceFormat}:${targetFormat}`);
    if (directFn) {
      const directResult = directFn(model, result, stream, credentials);
      if (!directResult) return body; // fallback on null
      result = directResult;
    } else {
      // Step 1: source -> openai (if source is not openai)
      if (sourceFormat !== FORMATS.OPENAI) {
        const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
        if (toOpenAI) result = toOpenAI(model, result, stream, credentials) || result;
      }
      // Step 2: openai -> target (if target is not openai)
      if (targetFormat !== FORMATS.OPENAI) {
        const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
        if (fromOpenAI) result = fromOpenAI(model, result, stream, credentials) || result;
      }
    }
  }

  // Apply thinking to the target format
  const kiroThinkingMappedByTranslator =
    targetFormat === FORMATS.KIRO &&
    (sourceFormat === FORMATS.OPENAI || sourceFormat === FORMATS.CLAUDE);
  if (!kiroThinkingMappedByTranslator) {
    applyThinking(targetFormat, model, result, null, thinkingIntent || undefined);
  }

  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(
  targetFormat: string,
  sourceFormat: string,
  chunk: unknown,
  state: Record<string, unknown>,
): unknown[] {
  // If same format, return as-is
  if (sourceFormat === targetFormat) return [chunk];

  let results: unknown[] = [chunk];

  // Direct route
  const directFn = responseRegistry.get(`${targetFormat}:${sourceFormat}`);
  if (directFn) {
    const converted = directFn(chunk, state);
    return converted ? (Array.isArray(converted) ? converted : [converted]) : [];
  }

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      results = [];
      const converted = toOpenAI(chunk, state);
      if (converted) results = Array.isArray(converted) ? converted : [converted];
    }
  }

  // Step 2: openai -> source (if source is not openai)
  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = responseRegistry.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults: unknown[] = [];
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) finalResults.push(...(Array.isArray(converted) ? converted : [converted]));
      }
      results = finalResults;
    }
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat: string, targetFormat: string): boolean {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1,
  };

  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return {
      ...base,
      seq: 0,
      responseId: `resp_${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: '',
      reasoningIndex: -1,
      reasoningBuf: '',
      reasoningPartAdded: false,
      reasoningDone: false,
      inThinking: false,
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcItemAdded: {},
      funcArgsDone: {},
      funcItemDone: {},
      customToolNames: new Set(),
      completedSent: false,
    };
  }

  return base;
}

// Kept for backward compatibility; translators are already registered at import time.
export function initTranslators(): void {
  // No-op — side-effect imports handle registration.
}

// Alias for clarity
export const getTranslator = (from: string, to: string, type: 'request' | 'response' = 'request') => {
  const registry = type === 'request' ? requestRegistry : responseRegistry;
  return registry.get(`${from}:${to}`) || null;
};

// Static side-effect imports: each module calls register() at load.
import './request/claude-to-openai.js';
import './request/openai-to-claude.js';
import './request/gemini-to-openai.js';
import './request/openai-to-gemini.js';
import './request/openai-to-vertex.js';
import './request/antigravity-to-openai.js';
import './request/openai-responses.js';
import './request/openai-to-kiro.js';
import './request/openai-to-cursor.js';
import './request/openai-to-ollama.js';
import './request/openai-to-commandcode.js';
import './request/claude-to-kiro.js';
import './response/claude-to-openai.js';
import './response/openai-to-claude.js';
import './response/gemini-to-openai.js';
import './response/openai-to-antigravity.js';
import './response/openai-responses.js';
import './response/kiro-to-openai.js';
import './response/cursor-to-openai.js';
import './response/ollama-to-openai.js';
import './response/commandcode-to-openai.js';
import './response/kiro-to-claude.js';
