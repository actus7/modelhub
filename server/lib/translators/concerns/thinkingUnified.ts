// Unified thinking normalization: extract client intent → apply provider-native format.
// Simplified for ModelHub port — no external provider/capabilities dependencies.

import { LEVEL_TO_BUDGET, budgetToLevel, effortToBudget, effortToThinkingLevel } from './thinking.js';

const FORMAT_TO_NATIVE: Record<string, string> = {
  openai: 'openai',
  'openai-responses': 'openai',
  'openai-response': 'openai',
  codex: 'openai',
  claude: 'claude-budget',
  gemini: 'gemini-budget',
  'gemini-cli': 'gemini-budget',
  vertex: 'gemini-budget',
  antigravity: 'gemini-budget',
  kiro: 'kiro',
};

export interface ThinkingConfig {
  mode: 'none' | 'auto' | 'level' | 'budget';
  budget?: number;
  level?: string;
}

export function stripThinkingSuffix(model: string): string {
  if (typeof model !== 'string') return model;
  const m = model.match(/^(.*)\([^()]+\)\s*$/);
  return m ? m[1].trim() : model;
}

export function parseSuffix(model: string): { cleanModel: string; override: ThinkingConfig | null } {
  if (typeof model !== 'string') return { cleanModel: model, override: null };
  const m = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!m) return { cleanModel: model, override: null };
  const cleanModel = m[1].trim();
  const raw = m[2].trim().toLowerCase();
  if (raw === 'none' || raw === 'off') return { cleanModel, override: { mode: 'none' } };
  if (raw === 'auto') return { cleanModel, override: { mode: 'auto' } };
  if (raw === 'ultra') return { cleanModel, override: { mode: 'level', level: raw } };
  if (/^\d+$/.test(raw)) return { cleanModel, override: { mode: 'budget', budget: Number(raw) } };
  if (LEVEL_TO_BUDGET[raw] !== undefined) return { cleanModel, override: { mode: 'level', level: raw } };
  return { cleanModel, override: null };
}

export function extractThinking(body: Record<string, unknown>): ThinkingConfig | null {
  if (!body || typeof body !== 'object') return null;

  const oc = (body.output_config as Record<string, unknown>)?.effort;
  if (typeof oc === 'string' && oc) {
    const e = oc.toLowerCase();
    if (e === 'none' || e === 'off') return { mode: 'none' };
    if (e === 'auto') return { mode: 'auto' };
    return { mode: 'level', level: e };
  }

  const t = body.thinking as Record<string, unknown> | undefined;
  if (t && typeof t === 'object') {
    if (t.type === 'disabled') return { mode: 'none' };
    if (t.type === 'adaptive' || t.type === 'enabled') {
      const budget = Number(t.budget_tokens);
      if (Number.isFinite(budget) && budget > 0) return { mode: 'budget', budget };
      return { mode: 'auto' };
    }
  }

  const effort = body.reasoning_effort ?? (typeof body.reasoning === 'object' ? (body.reasoning as Record<string, unknown>)?.effort : null);
  if (typeof effort === 'string' && effort) {
    const e = effort.toLowerCase();
    if (e === 'none' || e === 'off') return { mode: 'none' };
    if (e === 'auto') return { mode: 'auto' };
    return { mode: 'level', level: e };
  }

  const tc = body.thinkingConfig || (body.generationConfig as Record<string, unknown>)?.thinkingConfig || (body.request as Record<string, unknown>)?.generationConfig && ((body.request as Record<string, unknown>).generationConfig as Record<string, unknown>)?.thinkingConfig;
  if (tc && typeof tc === 'object') {
    const tcObj = tc as Record<string, unknown>;
    if (typeof tcObj.thinkingLevel === 'string') return { mode: 'level', level: tcObj.thinkingLevel.toLowerCase() };
    const tb = Number(tcObj.thinkingBudget);
    if (Number.isFinite(tb)) {
      if (tb === 0) return { mode: 'none' };
      if (tb < 0) return { mode: 'auto' };
      return { mode: 'budget', budget: tb };
    }
  }

  if (body.enable_thinking === false) return { mode: 'none' };
  if (body.enable_thinking === true) {
    const tb = Number(body.thinking_budget);
    if (Number.isFinite(tb) && tb > 0) return { mode: 'budget', budget: tb };
    return { mode: 'auto' };
  }

  return null;
}

export const captureThinking = extractThinking;

function resolveFormat(targetFormat: string): string {
  return FORMAT_TO_NATIVE[targetFormat] || 'openai';
}

function toBudget(cfg: ThinkingConfig): number | undefined {
  if (cfg.mode === 'budget') return cfg.budget;
  if (cfg.mode === 'level') return effortToBudget(cfg.level!);
  if (cfg.mode === 'auto') return -1;
  return undefined;
}

function toLevel(cfg: ThinkingConfig): string | null {
  if (cfg.mode === 'level') return cfg.level!;
  if (cfg.mode === 'budget') return budgetToLevel(cfg.budget!) || 'medium';
  if (cfg.mode === 'auto') return 'auto';
  return null;
}

function stripAll(body: Record<string, unknown>): void {
  delete body.thinking;
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.thinkingConfig;
  delete body.enable_thinking;
  delete body.thinking_budget;
  delete body.output_config;
  if (body.generationConfig) delete (body.generationConfig as Record<string, unknown>).thinkingConfig;
  const req = body.request as Record<string, unknown> | undefined;
  if (req?.generationConfig) delete (req.generationConfig as Record<string, unknown>).thinkingConfig;
}

function applyFormat(fmt: string, body: Record<string, unknown>, cfg: ThinkingConfig): void {
  const none = cfg.mode === 'none';

  switch (fmt) {
    case 'openai': {
      if (none) { body.reasoning_effort = 'none'; break; }
      const level = toLevel(cfg);
      if (level) body.reasoning_effort = level;
      break;
    }
    case 'claude-budget': {
      if (none) { body.thinking = { type: 'disabled' }; break; }
      const budget = toBudget(cfg);
      body.thinking = budget === -1 ? { type: 'enabled' } : { type: 'enabled', budget_tokens: budget || 8192 };
      break;
    }
    case 'gemini-budget': {
      if (none) {
        setGeminiThinking(body, { thinkingBudget: 0, includeThoughts: false });
        break;
      }
      const budget = toBudget(cfg);
      setGeminiThinking(body, { thinkingBudget: budget ?? -1, includeThoughts: true });
      break;
    }
    case 'kiro':
      break;
    default:
      break;
  }
}

function getGeminiGenerationConfig(body: Record<string, unknown>): Record<string, unknown> {
  const req = body.request as Record<string, unknown> | undefined;
  if (req && typeof req === 'object') {
    if (!req.generationConfig || typeof req.generationConfig !== 'object') {
      req.generationConfig = {};
    }
    return req.generationConfig as Record<string, unknown>;
  }
  if (!body.generationConfig || typeof body.generationConfig !== 'object') {
    body.generationConfig = {};
  }
  return body.generationConfig as Record<string, unknown>;
}

function setGeminiThinking(body: Record<string, unknown>, tc: Record<string, unknown>): void {
  const gc = getGeminiGenerationConfig(body);
  gc.thinkingConfig = tc;
}

export function applyThinking(
  targetFormat: string,
  model: string,
  body: Record<string, unknown>,
  _provider: string | null = null,
  intent: ThinkingConfig | undefined = undefined,
): Record<string, unknown> {
  if (!body || typeof body !== 'object') return body;

  const { override } = parseSuffix(model);
  const cfg = override || intent || extractThinking(body);
  if (!cfg) return body;

  const fmt = resolveFormat(targetFormat);
  stripAll(body);
  applyFormat(fmt, body, cfg);
  return body;
}
