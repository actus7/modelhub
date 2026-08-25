// Pre-fetch remote image URLs — simplified stub for ModelHub port.
// The full implementation requires SSRF protection and network calls;
// this is a no-op placeholder that preserves the API surface.
import { FORMATS } from '../formats.js';

export async function prefetchRemoteImages(
  _body: Record<string, unknown>,
  _sourceFormat: string,
  _targetFormat: string,
  _options?: Record<string, unknown>,
): Promise<number> {
  // No-op in ModelHub port — image prefetching is handled at the provider level.
  return 0;
}
