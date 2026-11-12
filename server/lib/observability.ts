const RESERVED_TOP_LEVEL_ROUTES = new Set([
  "conversations",
  "debug",
  "health",
  "providers",
  "user",
  "v1",
]);

const RESPONSE_PROVIDER_HEADER = "x-gateway-provider";

function classifyHttpStatus(status: number): string {
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

export function resolveProviderFromPath(pathname: string): string | undefined {
  const [firstSegment] = pathname.split("/").filter(Boolean);
  if (!firstSegment || RESERVED_TOP_LEVEL_ROUTES.has(firstSegment)) {
    return undefined;
  }

  return firstSegment;
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

export function logHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  provider?: string;
}): void {
  console.info(
    `[http-request] ${JSON.stringify({
      durationMs: input.durationMs,
      errorClass: classifyHttpStatus(input.status),
      method: input.method,
      provider: input.provider ?? null,
      route: input.route,
      status: input.status,
    })}`,
  );
}
