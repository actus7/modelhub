import { describe, expect, it, vi } from "vitest";

const mockPrisma = {
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const { createDuckAiChatHandler } = await import("../providers/duckai");
const { parseChatStream } = await import("@/lib/chat-stream");

type DuckAiOverrides = NonNullable<Parameters<typeof createDuckAiChatHandler>[0]>;

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
    status: 200,
  });
}

function createHandler(overrides: {
  sendChatRequest: DuckAiOverrides["sendChatRequest"];
  getVqdData?: DuckAiOverrides["getVqdData"];
  sleep?: DuckAiOverrides["sleep"];
}) {
  return createDuckAiChatHandler({
    buildDuckAiDurableStreamPayload: vi.fn().mockResolvedValue({
      conversationId: "conv",
      messageId: "msg",
      publicKey: { alg: "RSA-OAEP-256", e: "AQAB", ext: true, kty: "RSA", n: "key", use: "enc" },
    }),
    getReasoningEffort: vi.fn().mockResolvedValue(undefined),
    getVqdData: (overrides.getVqdData ??
      vi.fn().mockResolvedValue({
        browserFallbackUsed: false,
        cookies: "",
        hashPayload: "hash",
        jsdomAttempts: 1,
      })) as DuckAiOverrides["getVqdData"],
    sendChatRequest: overrides.sendChatRequest,
    sleep: (overrides.sleep ?? vi.fn().mockResolvedValue(undefined)) as DuckAiOverrides["sleep"],
  });
}

describe("Duck.ai chat retry handling", () => {
  it("retries ERR_BN_LIMIT without re-solving VQD on every attempt", async () => {
    const getVqdData = vi.fn().mockResolvedValue({
      browserFallbackUsed: false,
      cookies: "vqd_cookie=1",
      hashPayload: "hash",
      jsdomAttempts: 1,
    });
    const sendChatRequest = vi
      .fn()
      .mockResolvedValueOnce({
        cookies: "chat_cookie=1",
        response: new Response(
          JSON.stringify({ overrideCode: "dd89", status: 418, type: "ERR_BN_LIMIT" }),
          { status: 418 },
        ),
      })
      .mockResolvedValueOnce({
        cookies: "chat_cookie=2",
        response: new Response(
          JSON.stringify({ overrideCode: "f46c", status: 418, type: "ERR_BN_LIMIT" }),
          { status: 418 },
        ),
      })
      .mockResolvedValueOnce({
        cookies: "",
        response: createSseResponse(['data: {"role":"assistant","content":"OK"}\n\n']),
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const handler = createHandler({ getVqdData, sendChatRequest, sleep });
    const response = await handler([{ content: "hello", role: "user" }], "gpt-4o-mini");
    const parsed = await parseChatStream(response, {});

    expect(response.ok).toBe(true);
    expect(getVqdData).toHaveBeenCalledTimes(1);
    expect(sendChatRequest).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(parsed).toEqual({
      errorMessage: undefined,
      hadPartialOutput: true,
      text: "OK",
    });
  });

  it("retries challenge failures until a later attempt succeeds", async () => {
    const sendChatRequest = vi
      .fn()
      .mockResolvedValueOnce({
        cookies: "",
        response: new Response(
          JSON.stringify({ overrideCode: "dd89", status: 418, type: "ERR_CHALLENGE" }),
          { status: 418 },
        ),
      })
      .mockResolvedValueOnce({
        cookies: "",
        response: new Response(
          JSON.stringify({ overrideCode: "dd89", status: 418, type: "ERR_CHALLENGE" }),
          { status: 418 },
        ),
      })
      .mockResolvedValueOnce({
        cookies: "",
        response: createSseResponse(['data: {"role":"assistant","content":"OK"}\n\n']),
      });

    const handler = createHandler({ sendChatRequest });
    const response = await handler([{ content: "hello", role: "user" }], "gpt-4o-mini");
    const parsed = await parseChatStream(response, {});

    expect(response.ok).toBe(true);
    expect(sendChatRequest).toHaveBeenCalledTimes(3);
    expect(parsed).toEqual({
      errorMessage: undefined,
      hadPartialOutput: true,
      text: "OK",
    });
  });

  it("returns a generic 503 after exhausting retryable Duck.ai failures", async () => {
    const sendChatRequest = vi.fn().mockResolvedValue({
      cookies: "",
      response: new Response(
        JSON.stringify({ overrideCode: "dd89", status: 418, type: "ERR_CHALLENGE" }),
        { status: 418 },
      ),
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ sendChatRequest, sleep });

    const response = await handler([{ content: "hello", role: "user" }], "gpt-4o-mini");
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(payload.error).toMatch(/temporarily unavailable/i);
    expect(sendChatRequest).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("returns a generic 503 when VQD challenge resolution keeps failing", async () => {
    const getVqdData = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "VQD challenge failed after 4 jsdom attempts and browser fallback. Last jsdom error: ERR_REQUIRE_ESM. Browser error: Could not find Chrome.",
        ),
      );
    const sendChatRequest = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ getVqdData, sendChatRequest, sleep });

    const response = await handler([{ content: "hello", role: "user" }], "gpt-4o-mini");
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(payload.error).toMatch(/temporarily unavailable/i);
    expect(getVqdData).toHaveBeenCalledTimes(5);
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("does not retry when the configured browser runtime is unavailable", async () => {
    const getVqdData = vi
      .fn()
      .mockRejectedValue(
        new Error("Duck.ai browser challenge failed: Could not find Chrome."),
      );
    const sendChatRequest = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ getVqdData, sendChatRequest, sleep });

    const response = await handler(
      [{ content: "hello", role: "user" }],
      "gpt-4o-mini",
    );

    expect(response.status).toBe(500);
    expect(getVqdData).toHaveBeenCalledTimes(1);
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry permanent upstream client errors", async () => {
    const sendChatRequest = vi.fn().mockResolvedValue({
      cookies: "",
      response: new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ sendChatRequest, sleep });

    const response = await handler([{ content: "hello", role: "user" }], "gpt-4o-mini");

    expect(response.status).toBe(400);
    expect(sendChatRequest).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
