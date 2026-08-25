// Build a base64 data URI from mime + base64 payload
export function encodeDataUri(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

// Parse a base64 data URI → { mimeType, base64 }, or null if not a data URI.
const DATA_URI_RE = /^data:([^;]+);base64,([\s\S]+)$/;
export function parseDataUri(url: string): { mimeType: string; base64: string } | null {
  if (typeof url !== 'string') return null;
  const m = url.match(DATA_URI_RE);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}
