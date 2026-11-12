import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, runWithRequestContext } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function captureLine(method: "info" | "warn" | "error"): () => Record<string, unknown> {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  return () => JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe("logger", () => {
  it("emits one JSON line with level, event and fields", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const read = captureLine("info");

    logger.info("http.request", { status: 200 });

    expect(read()).toMatchObject({ event: "http.request", level: "info", status: 200 });
  });

  it("attaches the request id of the surrounding request context", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const read = captureLine("warn");

    runWithRequestContext({ requestId: "req-1" }, () => logger.warn("something"));

    expect(read().requestId).toBe("req-1");
  });

  it("serializes errors and redacts secrets in their messages", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const read = captureLine("error");

    logger.error("upstream.failed", { error: new Error("denied for Bearer abcdef1234567890") });

    const error = read().error as { message: string; name: string };
    expect(error.name).toBe("Error");
    expect(error.message).toBe("denied for Bearer [REDACTED]");
  });

  it("drops events below the configured level and is silent by default in tests", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("hidden.by.default");
    vi.stubEnv("LOG_LEVEL", "error");
    logger.info("below.level");
    logger.error("visible");

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
