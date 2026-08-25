// Shared translator registries — separate module to avoid TDZ with side-effect imports.

export type RequestTranslatorFn = (
  model: string,
  body: Record<string, unknown>,
  stream: boolean,
  credentials?: unknown,
) => Record<string, unknown> | null;

export type ResponseTranslatorFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chunk: any,
  state: Record<string, unknown>,
) => unknown[] | unknown | null;

// Mutable registries — initialized eagerly so side-effect imports can call register()
// during module evaluation (ESM hoists imports before module body).
export const requestRegistry = new Map<string, RequestTranslatorFn>();
export const responseRegistry = new Map<string, ResponseTranslatorFn>();

export function registerTranslator(
  from: string,
  to: string,
  requestFn: RequestTranslatorFn | null,
  responseFn: ResponseTranslatorFn | null,
): void {
  const key = `${from}:${to}`;
  if (requestFn) requestRegistry.set(key, requestFn);
  if (responseFn) responseRegistry.set(key, responseFn);
}
