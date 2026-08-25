// Convert OpenAI request to Gemini format
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  extractTextContent,
  tryParseJSON,
  cleanJSONSchemaForAntigravity,
} from '../formats/gemini.js';
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from '../schema/index.js';

function sanitizeGeminiFunctionName(name: string): string {
  if (!name) return '_unknown';
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\-]/g, '_');
  if (!/^[a-zA-Z_]/.test(sanitized)) sanitized = '_' + sanitized;
  return sanitized.substring(0, 64);
}

function normalizeGeminiContents(contents: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts) || (c.parts as unknown[]).length === 0) continue;
    const last = out[out.length - 1];
    if (last?.role === c.role) (last.parts as unknown[]).push(...(c.parts as unknown[]));
    else out.push({ ...c, parts: [...(c.parts as unknown[])] });
  }
  return out;
}

function openaiToGeminiBase(model: string, body: Record<string, unknown>, _stream: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS,
  };

  if (body.temperature !== undefined) (result.generationConfig as Record<string, unknown>).temperature = body.temperature;
  if (body.top_p !== undefined) (result.generationConfig as Record<string, unknown>).topP = body.top_p;
  if (body.top_k !== undefined) (result.generationConfig as Record<string, unknown>).topK = body.top_k;
  if (body.max_tokens !== undefined) (result.generationConfig as Record<string, unknown>).maxOutputTokens = body.max_tokens;

  const tcID2Name: Record<string, string> = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
        for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
          if (tc.type === OPENAI_BLOCK.FUNCTION && tc.id && (tc.function as Record<string, unknown>)?.name) {
            tcID2Name[tc.id as string] = (tc.function as Record<string, unknown>).name as string;
          }
        }
      }
    }
  }

  const toolResponses: Record<string, string> = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      if (msg.role === ROLE.TOOL && msg.tool_call_id) {
        toolResponses[msg.tool_call_id as string] = msg.content as string;
      }
    }
  }

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      const role = msg.role as string;
      const content = msg.content;

      if (role === ROLE.SYSTEM && (body.messages as unknown[]).length > 1) {
        result.systemInstruction = {
          role: GEMINI_ROLE.USER,
          parts: [{ text: typeof content === 'string' ? content : extractTextContent(content) }],
        };
      } else if (role === ROLE.USER || (role === ROLE.SYSTEM && (body.messages as unknown[]).length === 1)) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) (result.contents as unknown[]).push({ role: GEMINI_ROLE.USER, parts });
      } else if (role === ROLE.ASSISTANT) {
        const parts: Record<string, unknown>[] = [];
        if (content) {
          const text = typeof content === 'string' ? content : extractTextContent(content);
          if (text) parts.push({ text });
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds: string[] = [];
          for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
            if (tc.type !== OPENAI_BLOCK.FUNCTION) continue;
            const fn = tc.function as Record<string, unknown>;
            const args = tryParseJSON(fn?.arguments || '{}');
            parts.push({ functionCall: { id: tc.id, name: sanitizeGeminiFunctionName(fn.name as string), args } });
            toolCallIds.push(tc.id as string);
          }
          if (parts.length > 0) (result.contents as unknown[]).push({ role: GEMINI_ROLE.MODEL, parts });
          const hasActualResponses = toolCallIds.some(fid => toolResponses[fid]);
          if (hasActualResponses) {
            const toolParts: Record<string, unknown>[] = [];
            for (const fid of toolCallIds) {
              if (!toolResponses[fid]) continue;
              let name = tcID2Name[fid];
              if (!name) {
                const idParts = fid.split('-');
                name = idParts.length > 2 ? idParts.slice(0, -2).join('-') : fid;
              }
              let resp: unknown = toolResponses[fid];
              let parsedResp = tryParseJSON(resp);
              if (parsedResp === null) parsedResp = { result: resp };
              else if (typeof parsedResp !== 'object') parsedResp = { result: parsedResp };
              toolParts.push({ functionResponse: { id: fid, name: sanitizeGeminiFunctionName(name), response: { result: parsedResp } } });
            }
            if (toolParts.length > 0) (result.contents as unknown[]).push({ role: GEMINI_ROLE.USER, parts: toolParts });
          }
        } else if (parts.length > 0) {
          (result.contents as unknown[]).push({ role: GEMINI_ROLE.MODEL, parts });
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools) && (body.tools as unknown[]).length > 0) {
    const functionDeclarations: Record<string, unknown>[] = [];
    for (const t of body.tools as Array<Record<string, unknown>>) {
      if (t.name && t.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(t.input_schema || { type: 'object', properties: {} }));
        functionDeclarations.push({ name: sanitizeGeminiFunctionName(t.name as string), description: t.description || '', parameters: cleanedSchema });
      } else if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
        const fn = t.function as Record<string, unknown>;
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(fn.parameters || { type: 'object', properties: {} }));
        functionDeclarations.push({ name: sanitizeGeminiFunctionName(fn.name as string), description: fn.description || '', parameters: cleanedSchema });
      }
    }
    if (functionDeclarations.length > 0) result.tools = [{ functionDeclarations }];
  }

  result.contents = normalizeGeminiContents(result.contents as Array<Record<string, unknown>>);
  return result;
}

export function openaiToGeminiRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  return openaiToGeminiBase(model, body, stream);
}

register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest, null);
