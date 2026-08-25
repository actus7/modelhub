// Concern: reasoning_effort ↔ provider-native thinking config.
// Central source of truth for level↔budget maps.

export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const LEVEL_TO_BUDGET: Record<string, number> = {
  none: 0,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 128000,
};

export function effortToBudget(effort: string | undefined): number | undefined {
  if (!effort) return undefined;
  return LEVEL_TO_BUDGET[String(effort).toLowerCase()];
}

export function effortToThinkingLevel(effort: string): string {
  const e = String(effort).toLowerCase().trim();
  if (e === 'none' || e === 'off') return 'minimal';
  if (e === 'xhigh' || e === 'max') return 'high';
  return e;
}

export function budgetToLevel(budget: number): string | null {
  const b = Number(budget);
  if (!b || b <= 0) return null;
  if (b <= 768) return 'minimal';
  if (b <= 4096) return 'low';
  if (b <= 16384) return 'medium';
  if (b <= 28672) return 'high';
  return 'xhigh';
}

export function budgetToEffort(budget: number): string | null {
  if (!budget || budget <= 0) return null;
  if (budget <= 2048) return 'low';
  if (budget <= 16384) return 'medium';
  return 'high';
}
