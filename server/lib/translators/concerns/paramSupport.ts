// Param support stripping — simplified for ModelHub port.
// Strip request params a given provider/model rejects upstream.

interface StripRule {
  provider?: string;
  match?: RegExp | ((model: string) => boolean);
  drop?: string[];
  flattenContent?: boolean;
}

const STRIP_RULES: StripRule[] = [
  { match: /claude/i, drop: ['temperature'] },
];

function matches(rule: StripRule, model: string): boolean {
  if (!rule.match) return true;
  return typeof rule.match === 'function' ? rule.match(model) : rule.match.test(model);
}

export function stripUnsupportedParams(
  provider: string | null,
  model: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!model || !body || typeof body !== 'object') return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages as Array<Record<string, unknown>>) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = (msg.content as Array<Record<string, unknown>>)
            .map(b => (b?.type === 'text' && typeof b.text === 'string') ? b.text : '')
            .join('');
        }
      }
    }
  }
  return body;
}
