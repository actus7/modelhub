import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const {
  createProviderApp,
  MAX_PROVIDER_REQUEST_BODY_BYTES,
  resolveMessagesForProvider,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  vercelStreamToOpenAiSse,
} = await import("../lib/provider-core");

const originalRequireAuth = process.env.REQUIRE_AUTH;

describe("provider payload limits", () => {
  beforeEach(() => {
    process.env.REQUIRE_AUTH = "false";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
  });

  it("rejects oversized request bodies before parsing", async () => {
    const app = createProviderApp({
      basePath: "/test-provider",
      chat: async () => new Response("ok"),
      defaultModel: "demo-model",
      models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
      providerId: "test-provider",
    });

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
      }),
      headers: {
        "content-length": String(MAX_PROVIDER_REQUEST_BODY_BYTES + 1),
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  /** Clientes OpenAI-compatible podem enviar developer, content null e arguments como objeto. */
  it("accepts OpenAI-compatible payloads (developer role, null content, tool arguments as object)", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"));

    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
      providerId: "test-provider",
    });

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [
          { content: "instruções", role: "developer" },
          { content: "oi", role: "user" },
          {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: { arguments: { query: "x" }, name: "search" },
                id: "call_abc",
                type: "function",
              },
            ],
          },
        ],
        modelId: "demo-model",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(chat).toHaveBeenCalled();
    const firstArg = chat.mock.calls[0]?.[0] as Array<{ role: string; tool_calls?: Array<{ function: { arguments: string } }> }>;
    expect(firstArg[0]?.role).toBe("system");
    expect(firstArg[2]?.tool_calls?.[0]?.function.arguments).toBe('{"query":"x"}');
  });

  it("accepts more than 50 messages (agent sessions with tools)", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"));
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
      providerId: "test-provider",
    });

    const messages = Array.from({ length: 60 }, (_, i) => ({
      content: `m${i}`,
      role: "user" as const,
    }));

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({ messages, modelId: "demo-model" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
  });

  it("rejects tool calls when the selected model does not support tools", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"));
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "text-only-model",
      models: [{ capabilities: { documents: true, images: false, tools: false }, id: "text-only-model", name: "Text Only" }],
      providerId: "test-provider",
    });

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        modelId: "text-only-model",
        tools: [{ function: { name: "search", parameters: {} }, type: "function" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Modelo "text-only-model" nao suporta tools' });
    expect(chat).not.toHaveBeenCalled();
  });

  it("accepts a large system prompt with tool inventory", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"));
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
      providerId: "test-provider",
    });

    const giantSystemPrompt = `You are an agentic runtime.\n${"tool: read, write, edit, exec, browser\n".repeat(2500)}`;

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [
          { content: giantSystemPrompt, role: "system" },
          { content: "Oi tudo bem?", role: "user" },
        ],
        modelId: "demo-model",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: giantSystemPrompt,
          role: "system",
        }),
      ]),
      "demo-model",
      expect.any(Object),
      expect.any(Object),
      undefined,
    );
  });

  it("injects extracted document text into the provider payload", async () => {
    mockPrisma.conversationAttachment.findMany.mockResolvedValueOnce([
      {
        blob: new Uint8Array([1, 2, 3]),
        extractedText: "Quarterly report body",
        extractionStatus: "completed",
        fileName: "report.docx",
        id: "att-doc-1",
        kind: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);

    const messages = await resolveMessagesForProvider({
      config: {
        basePath: "/test-provider",
        chat: async () => new Response("ok"),
        defaultModel: "demo-model",
        models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
        providerId: "test-provider",
      },
      credentials: {},
      messages: [{
        content: [{
          attachmentId: "att-doc-1",
          fileName: "report.docx",
          kind: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          type: "attachment",
        }],
        role: "user",
      }],
      modelId: "demo-model",
      userId: "user-1",
    });

    expect(messages[0]?.content).toEqual([
      {
        text: "[document:report.docx mime=application/vnd.openxmlformats-officedocument.wordprocessingml.document]\nQuarterly report body\n[/document]",
        type: "text",
      },
    ]);
  });

  it("rejects image attachments when the selected model lacks vision support", async () => {
    mockPrisma.conversationAttachment.findMany.mockResolvedValueOnce([
      {
        blob: new Uint8Array([255, 216, 255]),
        extractedText: null,
        extractionStatus: "completed",
        fileName: "photo.jpg",
        id: "att-img-1",
        kind: "image",
        mimeType: "image/jpeg",
      },
    ]);

    await expect(
      resolveMessagesForProvider({
        config: {
          basePath: "/test-provider",
          chat: async () => new Response("ok"),
          defaultModel: "demo-model",
          models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
          providerId: "test-provider",
        },
        credentials: {},
        messages: [{
          content: [{
            attachmentId: "att-img-1",
            fileName: "photo.jpg",
            kind: "image",
            mimeType: "image/jpeg",
            type: "attachment",
          }],
          role: "user",
        }],
        modelId: "demo-model",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      message: 'Modelo "demo-model" nao suporta anexos de imagem',
      status: 400,
    });
  });
});

async function readText(response: Response): Promise<string> {
  return response.text();
}

function extractOpenAiSseText(sse: string): string {
  let text = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const payload = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> };
    text += payload.choices?.[0]?.delta?.content ?? "";
  }
  return text;
}

function extractVercelText(streamText: string): string {
  let text = "";
  for (const line of streamText.split("\n")) {
    if (!line.startsWith("0:")) continue;
    text += JSON.parse(line.slice(2)) as string;
  }
  return text;
}

describe("hidden reasoning sanitization", () => {
  it("removes thought blocks from single text responses", async () => {
    const response = toVercelSingleTextResponse("antes <thought>private</thought> depois");

    await expect(readText(response)).resolves.toContain('0:"antes  depois"');
  });

  it("removes split thought blocks when converting Vercel stream to OpenAI SSE", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('0:"ok <tho"\n'));
        controller.enqueue(new TextEncoder().encode('0:"ught>private</thought> fim"\n'));
        controller.enqueue(new TextEncoder().encode('d:{"finishReason":"stop"}\n'));
        controller.close();
      },
    });

    const response = vercelStreamToOpenAiSse(new Response(stream), "demo/model");
    const body = await response.text();

    expect(extractOpenAiSseText(body)).toBe("ok  fim");
    expect(body).not.toContain("private");
    expect(body).not.toContain("<thought>");
  });

  it("removes thought blocks when converting upstream OpenAI SSE to Vercel stream", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"a <think>hidden"}}]}',
      'data: {"choices":[{"delta":{"content":" still hidden</think> b"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n");

    const response = toVercelStreamFromOpenAiSse(new Response(upstream));
    const body = await response.text();

    expect(extractVercelText(body)).toBe("a  b");
    expect(body).not.toContain("hidden");
    expect(body).toContain('d:{"finishReason":"stop"}');
  });
});
