const RESPONSE_PROVIDER_HEADER = "x-gateway-provider";

export const REQUEST_ID_HEADER = "x-request-id";

const MAX_REQUEST_ID_LENGTH = 128;

export function classifyHttpStatus(status: number): string {
  if (status < 400) return "ok";
  if (status === 400) return "bad_request";
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status === 503) return "service_unavailable";
  if (status >= 500) return "server_error";
  return "client_error";
}

/** Reaproveita o id enviado pelo cliente/proxy quando é seguro logá-lo; senão gera um. */
export function resolveRequestId(headerValue: string | undefined): string {
  const candidate = headerValue?.trim();
  if (candidate && candidate.length <= MAX_REQUEST_ID_LENGTH && /^[\w.:-]+$/.test(candidate)) {
    return candidate;
  }

  return crypto.randomUUID();
}

export function withProviderMetadata(response: Response, providerId: string): Response {
  if (response.headers.get(RESPONSE_PROVIDER_HEADER) === providerId) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(RESPONSE_PROVIDER_HEADER, providerId);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function getProviderFromResponse(response: Response): string | undefined {
  return response.headers.get(RESPONSE_PROVIDER_HEADER) ?? undefined;
}
