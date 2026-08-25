// Kiro conversation helpers — simplified for ModelHub port.
// Preserves the core normalization logic without external dependencies.

const KIRO_TOOL_DESCRIPTION_MAX_LENGTH = 10000;
const KIRO_TOOL_ID_MAX_LENGTH = 128;
const KIRO_TOOL_NAME_MAX_LENGTH = 64;

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function trimCodePoints(value: string, limit: number): string {
  return [...String(value || '')].slice(0, limit).join('');
}

function uniqueName(rawName: string, index: number, usedNames: Set<string>): string {
  const cleaned = String(rawName || '').trim().replace(TOOL_NAME_PATTERN, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const base = trimCodePoints(cleaned || `tool_${index + 1}`, KIRO_TOOL_NAME_MAX_LENGTH);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function cleanSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchemaValue);
  if (!value || typeof value !== 'object') return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    if (key === 'required' && Array.isArray(child) && child.length === 0) continue;
    cleaned[key] = cleanSchemaValue(child);
  }
  return cleaned;
}

function normalizeRootSchema(schema: unknown): Record<string, unknown> {
  const cleaned = cleanSchemaValue(schema && typeof schema === 'object' ? clone(schema) : {}) as Record<string, unknown>;
  cleaned.type = 'object';
  if (!cleaned.properties || typeof cleaned.properties !== 'object' || Array.isArray(cleaned.properties)) {
    cleaned.properties = {};
  }
  if (Array.isArray(cleaned.required)) {
    cleaned.required = [...new Set((cleaned.required as string[]).filter(
      (name) => typeof name === 'string' && Object.hasOwn(cleaned.properties as object, name),
    ))];
    if ((cleaned.required as unknown[]).length === 0) delete cleaned.required;
  }
  return cleaned;
}

export interface KiroToolSpec {
  toolSpecification: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

export function normalizeKiroToolSpecs(tools: unknown[]): { specs: KiroToolSpec[]; nameMap: Map<string, string> } {
  const specs: KiroToolSpec[] = [];
  const nameMap = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const [index, tool] of (Array.isArray(tools) ? tools : []).entries()) {
    if (!tool || typeof tool !== 'object') continue;
    const t = tool as Record<string, unknown>;
    const fn = t.function as Record<string, unknown> | undefined;
    const rawName = (fn?.name ?? t.name) as string | undefined;
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    if (nameMap.has(rawName)) continue;
    const name = uniqueName(rawName, index, usedNames);
    nameMap.set(rawName, name);

    const rawDescription = (fn?.description ?? t.description ?? `Tool: ${rawName}`) as string;
    const description = trimCodePoints(String(rawDescription || `Tool: ${rawName}`), KIRO_TOOL_DESCRIPTION_MAX_LENGTH);
    const schema = fn?.parameters ?? t.parameters ?? t.input_schema ?? {};
    specs.push({
      toolSpecification: {
        name,
        description,
        inputSchema: { json: normalizeRootSchema(schema) },
      },
    });
  }

  return { specs, nameMap };
}

export interface KiroValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateKiroConversation(
  history: unknown[],
  currentMessage: unknown,
  toolSpecs: KiroToolSpec[] = [],
): KiroValidationResult {
  const errors: string[] = [];
  const turns = [...(history || []), currentMessage].filter(Boolean);
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter(Boolean));
  const usedIds = new Set<string>();

  for (let index = 0; index < turns.length; index++) {
    const expectedUser = index % 2 === 0;
    const turn = turns[index] as Record<string, unknown>;
    const isUser = !!turn?.userInputMessage;
    if (isUser !== expectedUser) errors.push(`role:${index}`);
    if (!isUser) {
      const assistant = turn.assistantResponseMessage as Record<string, unknown> | undefined;
      const calls = (assistant?.toolUses || []) as Array<Record<string, unknown>>;
      const nextTurn = turns[index + 1] as Record<string, unknown> | undefined;
      const nextUser = nextTurn?.userInputMessage as Record<string, unknown> | undefined;
      const results = (nextUser?.userInputMessageContext as Record<string, unknown>)?.toolResults as Array<Record<string, unknown>> || [];
      const callIds = calls.map((call) => call.toolUseId);
      const resultIds = results.map((result) => result.toolUseId);
      if (calls.length !== results.length || callIds.some((id) => !resultIds.includes(id))) {
        errors.push(`pair:${index}`);
      }
      for (const call of calls) {
        if (!call.toolUseId || usedIds.has(call.toolUseId as string)) errors.push(`id:${index}`);
        usedIds.add(call.toolUseId as string);
        if (!specNames.has(call.name as string)) errors.push(`spec:${index}`);
      }
    }
  }
  const current = currentMessage as Record<string, unknown> | undefined;
  const userInput = current?.userInputMessage as Record<string, unknown> | undefined;
  if (!userInput?.content) errors.push('current');
  return { valid: errors.length === 0, errors };
}

export function canonicalizeKiroConversation({
  history,
  currentMessage,
  modelId,
  toolSpecs = [],
  nameMap = new Map(),
}: {
  history: unknown[];
  currentMessage: unknown;
  modelId: string;
  toolSpecs?: KiroToolSpec[];
  nameMap?: Map<string, string>;
}): { history: unknown[]; currentMessage: unknown; repairs: Record<string, number>; valid: boolean; errors: string[] } {
  // Simplified canonicalization — just validate and return
  const validation = validateKiroConversation(history, currentMessage, toolSpecs);
  return {
    history,
    currentMessage,
    repairs: { missingResults: 0, orphanResults: 0, invalidToolUses: 0 },
    valid: validation.valid,
    errors: validation.errors,
  };
}
