import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("./lib/db", () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock("./env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const { default: app } = await import("./app");
const { resetReadinessCacheForTests } = await import("./lib/health");

beforeEach(() => {
  vi.clearAllMocks();
  resetReadinessCacheForTests();
});

describe("GET /health", () => {
  it("reports liveness without touching the database", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("GET /health/ready", () => {
  it("returns 200 when the database answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await app.request("/health/ready");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checks: { database: "ok" }, status: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await app.request("/health/ready");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { database: "unavailable" }, status: "unavailable" });
  });

  it("reuses the last result instead of querying the database on every call", async () => {
    queryRaw.mockResolvedValue([]);

    await app.request("/health/ready");
    await app.request("/health/ready");

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("request id", () => {
  it("echoes a well-formed x-request-id sent by the client", async () => {
    const res = await app.request("/health", { headers: { "x-request-id": "abc-123" } });

    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("replaces a malformed x-request-id with a generated one", async () => {
    const res = await app.request("/health", { headers: { "x-request-id": "bad id\twith spaces" } });

    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
