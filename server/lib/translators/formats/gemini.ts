// Gemini helper functions for translator
import { safeParseJSON } from '../concerns/json.js';
import { OPENAI_BLOCK } from '../schema/index.js';

export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  'minLength', 'maxLength', 'exclusiveMinimum', 'exclusiveMaximum',
  'minItems', 'maxItems', 'format', 'multipleOf',
  'uniqueItems', 'contains',
  'unevaluatedProperties', 'unevaluatedItems', 'contentSchema',
  'default', 'examples',
  '$schema', '$defs', 'definitions', 'const', '$ref', '$comment',
  'deprecated', 'readOnly', 'writeOnly',
  'additionalProperties', 'propertyNames', 'patternProperties', 'enumDescriptions',
  'anyOf', 'oneOf', 'allOf', 'not',
  'dependencies', 'dependentSchemas', 'dependentRequired',
  'title', 'optional', 'if', 'then', 'else', 'contentMediaType', 'contentEncoding',
  'cornerRadius', 'fillColor', 'fontFamily', 'fontSize', 'fontWeight',
  'gap', 'padding', 'strokeColor', 'strokeThickness', 'textColor',
];

export const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
];

export function convertOpenAIContentToParts(content: unknown): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (typeof content === 'string') {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content as Array<Record<string, unknown>>) {
      if (item.type === OPENAI_BLOCK.TEXT) {
        parts.push({ text: item.text });
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && (item.image_url as Record<string, unknown>)?.url) {
        const url = (item.image_url as Record<string, unknown>).url as string;
        if (url.startsWith('data:')) {
          const commaIndex = url.indexOf(',');
          if (commaIndex !== -1) {
            const mimePart = url.substring(5, commaIndex);
            const data = url.substring(commaIndex + 1);
            const mimeType = mimePart.split(';')[0];
            parts.push({ inlineData: { mime_type: mimeType, data } });
          }
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
          parts.push({ fileData: { fileUri: url, mimeType: 'image/*' } });
        }
      } else if (item.type === OPENAI_BLOCK.INPUT_AUDIO && (item.input_audio as Record<string, unknown>)?.data) {
        const ia = item.input_audio as Record<string, unknown>;
        const format = (ia.format as string) || 'wav';
        const mimeType = format === 'mp3' ? 'audio/mpeg' : `audio/${format}`;
        parts.push({ inlineData: { mime_type: mimeType, data: ia.data } });
      } else if (item.type === OPENAI_BLOCK.FILE && (item.file as Record<string, unknown>)?.file_data) {
        const fileData = (item.file as Record<string, unknown>).file_data as string;
        if (fileData.startsWith('data:')) {
          const commaIndex = fileData.indexOf(',');
          if (commaIndex !== -1) {
            const mimeType = fileData.substring(5, commaIndex).split(';')[0];
            const data = fileData.substring(commaIndex + 1);
            parts.push({ inlineData: { mime_type: mimeType, data } });
          }
        }
      }
    }
  }
  return parts;
}

export function extractTextContent(content: unknown, separator = ''): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter(c => c.type === OPENAI_BLOCK.TEXT)
      .map(c => c.text as string)
      .join(separator);
  }
  return '';
}

export function tryParseJSON(str: unknown): unknown {
  return safeParseJSON(str, null);
}

export function generateRequestId(): string {
  return `agent-${crypto.randomUUID()}`;
}

export function generateSessionId(): string {
  return crypto.randomUUID() + Date.now().toString();
}

export function generateProjectId(): string {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

function removeUnsupportedKeywords(obj: unknown, keywords: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) removeUnsupportedKeywords(item, keywords);
    return;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (keywords.includes(key) || key.startsWith('x-')) {
      delete (obj as Record<string, unknown>)[key];
      continue;
    }
    const value = (obj as Record<string, unknown>)[key];
    if (value && typeof value === 'object') removeUnsupportedKeywords(value, keywords);
  }
}

function convertConstToEnum(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.const !== undefined && !o.enum) {
    o.enum = [o.const];
    delete o.const;
  }
  for (const value of Object.values(o)) {
    if (value && typeof value === 'object') convertConstToEnum(value);
  }
}

function convertEnumValuesToStrings(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.enum && Array.isArray(o.enum)) {
    o.enum = o.enum.map((v: unknown) => String(v));
    if (!o.type) o.type = 'string';
  }
  for (const value of Object.values(o)) {
    if (value && typeof value === 'object') convertEnumValuesToStrings(value);
  }
}

function mergeAllOf(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.allOf && Array.isArray(o.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const item of o.allOf as Array<Record<string, unknown>>) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties as object, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required as string[]) {
          if (!(merged.required as string[]).includes(req)) (merged.required as string[]).push(req);
        }
      }
    }
    delete o.allOf;
    if (merged.properties) o.properties = { ...(o.properties as object), ...(merged.properties as object) };
    if (merged.required) o.required = [...((o.required || []) as string[]), ...(merged.required as string[])];
  }
  for (const value of Object.values(o)) {
    if (value && typeof value === 'object') mergeAllOf(value);
  }
}

function selectBest(items: Array<Record<string, unknown>>): number {
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;
    if (type === 'object' || item.properties) score = 3;
    else if (type === 'array' || item.items) score = 2;
    else if (type && type !== 'null') score = 1;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function flattenAnyOfOneOf(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.anyOf && Array.isArray(o.anyOf) && (o.anyOf as unknown[]).length > 0) {
    const nonNullSchemas = (o.anyOf as Array<Record<string, unknown>>).filter(s => s && s.type !== 'null');
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete o.anyOf;
      Object.assign(o, selected);
    }
  }
  if (o.oneOf && Array.isArray(o.oneOf) && (o.oneOf as unknown[]).length > 0) {
    const nonNullSchemas = (o.oneOf as Array<Record<string, unknown>>).filter(s => s && s.type !== 'null');
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete o.oneOf;
      Object.assign(o, selected);
    }
  }
  for (const value of Object.values(o)) {
    if (value && typeof value === 'object') flattenAnyOfOneOf(value);
  }
}

function flattenTypeArrays(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.type && Array.isArray(o.type)) {
    const nonNullTypes = (o.type as string[]).filter(t => t !== 'null');
    o.type = nonNullTypes.length > 0 ? nonNullTypes[0] : 'string';
  }
  for (const value of Object.values(o)) {
    if (value && typeof value === 'object') flattenTypeArrays(value);
  }
}

function ensureObjectType(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o.properties && !o.type) o.type = 'object';
  for (const v of Object.values(o)) if (v && typeof v === 'object') ensureObjectType(v);
}

export function cleanJSONSchemaForAntigravity(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const cleaned = schema as Record<string, unknown>;

  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);
  mergeAllOf(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);
  ensureObjectType(cleaned);
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  function cleanupRequired(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    if (o.required && Array.isArray(o.required) && o.properties) {
      const validRequired = (o.required as string[]).filter(field =>
        Object.prototype.hasOwnProperty.call(o.properties, field),
      );
      if (validRequired.length === 0) delete o.required;
      else o.required = validRequired;
    }
    for (const value of Object.values(o)) {
      if (value && typeof value === 'object') cleanupRequired(value);
    }
  }
  cleanupRequired(cleaned);

  function addPlaceholders(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    if (Object.keys(o).length === 0) {
      o.type = 'object';
      o.properties = { reason: { type: 'string', description: 'Brief explanation of why you are calling this tool' } };
      o.required = ['reason'];
      return;
    }
    if (o.type === 'object') {
      if (!o.properties || Object.keys(o.properties as object).length === 0) {
        o.properties = { reason: { type: 'string', description: 'Brief explanation of why you are calling this tool' } };
        o.required = ['reason'];
      }
    }
    for (const value of Object.values(o)) {
      if (value && typeof value === 'object') addPlaceholders(value);
    }
  }
  addPlaceholders(cleaned);

  return cleaned;
}
