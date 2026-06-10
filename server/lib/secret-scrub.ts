/**
 * Redação best-effort de credenciais que podem aparecer em corpos de erro
 * upstream antes de persistirmos em UsageLog.errorDetail ou devolvermos ao
 * cliente. Alguns provedores (notavelmente 401s da Anthropic) ecoam o header
 * Authorization/x-api-key de volta no corpo do erro — sem scrubbing, um único
 * 401 grava a chave do usuário no banco.
 *
 * Não é uma fronteira de segurança — é redução de raio de explosão.
 * (Padrão portado do Manifest: packages/backend/src/common/utils/secret-scrub.ts)
 */

type Pattern = { re: RegExp; replacement: string }

// Ordem importa: headers e Bearer primeiro, para colapsar o span inteiro antes
// que os regexes de vendor tentem (e deixem prefixos pendurados).
const PATTERNS: Pattern[] = [
  {
    re: /(["']?)(x-api-key|authorization|api-key)\1(\s*[:=]\s*)(["']?)[^"',}\r\n]+\4/gi,
    replacement: '$1$2$1$3$4[REDACTED]$4',
  },
  // Tokens OAuth são opacos (sem prefixo reconhecível) — redige pelo nome do campo.
  {
    re: /(["']?)(refresh_token|client_secret|access_token|device_code)\1(\s*[:=]\s*)(["']?)[^"',}&\s]+\4/gi,
    replacement: '$1$2$1$3$4[REDACTED]$4',
  },
  { re: /Bearer\s+[A-Za-z0-9_\-.=+/]{8,}/gi, replacement: 'Bearer [REDACTED]' },
  { re: /([?&])key=[^&\s"']+/g, replacement: '$1key=[REDACTED]' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bsk-proj-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bsk-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bgsk_[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bxai-[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { re: /\b(?:gho|ghu|ghp|ghs)_[A-Za-z0-9]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{10,}/g, replacement: '[REDACTED]' },
  { re: /\bAIza[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
]

export function scrubSecrets(text: string | null | undefined): string {
  if (text == null) return ''
  let out = text
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement)
  }
  return out
}
