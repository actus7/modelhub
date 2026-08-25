// Format identifiers
export const FORMATS = {
  OPENAI: 'openai',
  OPENAI_RESPONSES: 'openai-responses',
  OPENAI_RESPONSE: 'openai-response',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  GEMINI_CLI: 'gemini-cli',
  VERTEX: 'vertex',
  CODEX: 'codex',
  ANTIGRAVITY: 'antigravity',
  KIRO: 'kiro',
  CURSOR: 'cursor',
  OLLAMA: 'ollama',
  COMMANDCODE: 'commandcode',
} as const;

export type FormatId = (typeof FORMATS)[keyof typeof FORMATS];

/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(pathname: string, body: Record<string, unknown>): string | null {
  if (pathname.includes('/v1/responses')) return FORMATS.OPENAI_RESPONSES;
  if (pathname.includes('/v1/messages')) return FORMATS.CLAUDE;
  if (pathname.includes('/v1/chat/completions') && Array.isArray(body?.input)) {
    return FORMATS.OPENAI;
  }
  return null;
}
