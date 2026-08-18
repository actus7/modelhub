import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = {
  apiKey: {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockReturnValue({ catch: vi.fn() }),
  },
  conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  conversation: { findFirst: vi.fn().mockResolvedValue(null) },
  project: { findFirst: vi.fn().mockResolvedValue(null) },
  projectFile: { findMany: vi.fn().mockResolvedValue([]) },
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: {
    create: vi.fn().mockResolvedValue({ id: "log-1" }),
    update: vi.fn().mockReturnValue({ catch: vi.fn() }),
  },
  userBudget: { findUnique: vi.fn().mockResolvedValue(null) },
}

vi.mock("../lib/db", () => ({ prisma: mockPrisma }))
vi.mock("../env", () => ({}))
vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: vi.fn().mockResolvedValue({ data: null }) },
}))

const {
  createProviderApp,
  MAX_PROVIDER_REQUEST_BODY_BYTES,
  resolveMessagesForProvider,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  vercelStreamToOpenAiSse,
} = await import("../lib/provider-core")

const originalRequireAuth = process.env.REQUIRE_AUTH

describe("provider payload limits", () => {
  beforeEach(() => {
    process.env.REQUIRE_AUTH = "false"
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth
  })

  it("rejects oversized request bodies before parsing", async () => {
    const app = createProviderApp({
      basePath: "/test-provider",
      chat: async () => new Response("ok"),
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
      }),
      headers: {
        "content-length": String(MAX_PROVIDER_REQUEST_BODY_BYTES + 1),
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "Request body too large" })
  })

  /** Clientes OpenAI-compatible podem enviar developer, content null e arguments como objeto. */
  it("accepts OpenAI-compatible payloads (developer role, null content, tool arguments as object)", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"))

    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

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
    })

    expect(response.status).toBe(200)
    expect(chat).toHaveBeenCalled()
    const firstArg = chat.mock.calls[0]?.[0] as Array<{
      role: string
      tool_calls?: Array<{ function: { arguments: string } }>
    }>
    expect(firstArg[0]?.role).toBe("system")
    expect(firstArg[2]?.tool_calls?.[0]?.function.arguments).toBe(
      '{"query":"x"}',
    )
  })

  it("accepts more than 50 messages (agent sessions with tools)", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"))
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

    const messages = Array.from({ length: 60 }, (_, i) => ({
      content: `m${i}`,
      role: "user" as const,
    }))

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({ messages, modelId: "demo-model" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
  })

  it("rejects tool calls when the selected model does not support tools", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"))
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "text-only-model",
      models: [
        {
          capabilities: { documents: true, images: false, tools: false },
          id: "text-only-model",
          name: "Text Only",
        },
      ],
      providerId: "test-provider",
    })

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        modelId: "text-only-model",
        tools: [
          { function: { name: "search", parameters: {} }, type: "function" },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Modelo "text-only-model" nao suporta tools',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it("accepts a large system prompt with tool inventory", async () => {
    const chat = vi.fn().mockResolvedValue(new Response("ok"))
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

    const giantSystemPrompt = `You are an agentic runtime.\n${"tool: read, write, edit, exec, browser\n".repeat(2500)}`

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
    })

    expect(response.status).toBe(200)
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
    )
  })

  it("injects extracted document text into the provider payload", async () => {
    mockPrisma.conversationAttachment.findMany.mockResolvedValueOnce([
      {
        blob: new Uint8Array([1, 2, 3]),
        extractedText: "Quarterly report body",
        extractionStatus: "completed",
        fileName: "report.docx",
        id: "att-doc-1",
        kind: "document",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ])

    const messages = await resolveMessagesForProvider({
      config: {
        basePath: "/test-provider",
        chat: async () => new Response("ok"),
        defaultModel: "demo-model",
        models: [
          {
            capabilities: { documents: true, images: false },
            id: "demo-model",
            name: "Demo Model",
          },
        ],
        providerId: "test-provider",
      },
      credentials: {},
      messages: [
        {
          content: [
            {
              attachmentId: "att-doc-1",
              fileName: "report.docx",
              kind: "document",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              type: "attachment",
            },
          ],
          role: "user",
        },
      ],
      modelId: "demo-model",
      userId: "user-1",
    })

    expect(messages[0]?.content).toEqual([
      {
        text: "[document:report.docx mime=application/vnd.openxmlformats-officedocument.wordprocessingml.document]\nQuarterly report body\n[/document]",
        type: "text",
      },
    ])
  })

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
    ])

    await expect(
      resolveMessagesForProvider({
        config: {
          basePath: "/test-provider",
          chat: async () => new Response("ok"),
          defaultModel: "demo-model",
          models: [
            {
              capabilities: { documents: true, images: false },
              id: "demo-model",
              name: "Demo Model",
            },
          ],
          providerId: "test-provider",
        },
        credentials: {},
        messages: [
          {
            content: [
              {
                attachmentId: "att-img-1",
                fileName: "photo.jpg",
                kind: "image",
                mimeType: "image/jpeg",
                type: "attachment",
              },
            ],
            role: "user",
          },
        ],
        modelId: "demo-model",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      message: 'Modelo "demo-model" nao suporta anexos de imagem',
      status: 400,
    })
  })
})

describe("provider usage correlation and streaming metrics", () => {
  beforeEach(() => {
    process.env.REQUIRE_AUTH = "true"
    vi.clearAllMocks()
    mockPrisma.apiKey.findFirst.mockResolvedValue({
      expiresAt: null,
      id: "key-1",
      userId: "user-1",
    })
    mockPrisma.apiKey.update.mockReturnValue({ catch: vi.fn() })
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv-1" })
    mockPrisma.usageLog.create.mockResolvedValue({ id: "log-1" })
    mockPrisma.usageLog.update.mockReturnValue({ catch: vi.fn() })
  })

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth
  })

  it("correlaciona apenas conversa do usuario e atualiza a duracao ao fim do stream", async () => {
    const app = createProviderApp({
      basePath: "/test-provider",
      chat: async () =>
        new Response(
          '0:"ok"\nd:{"usage":{"promptTokens":2,"completionTokens":1}}\n',
        ),
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
      }),
      headers: {
        authorization: "Bearer sk-test",
        "content-type": "application/json",
        "x-modelhub-conversation-id": "conv-1",
        "x-modelhub-message-id": "assistant-1",
      },
      method: "POST",
    })
    await response.text()

    await vi.waitFor(() => {
      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: "conv-1",
            messageId: "assistant-1",
            userId: "user-1",
          }),
        }),
      )
      expect(mockPrisma.usageLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { durationMs: expect.any(Number) },
          where: { id: "log-1" },
        }),
      )
    })
  })
})

describe("project context injection", () => {
  const demoConfig = {
    basePath: "/test-provider",
    chat: async () => new Response("ok"),
    defaultModel: "demo-model",
    models: [
      {
        capabilities: { documents: true, images: false },
        id: "demo-model",
        name: "Demo Model",
      },
    ],
    providerId: "test-provider",
  }

  beforeEach(() => {
    process.env.REQUIRE_AUTH = "false"
    vi.clearAllMocks()
  })

  function systemContent(
    messages: Array<{ content: string | unknown[]; role: string }>,
  ): string {
    const system = messages[0]
    expect(system?.role).toBe("system")
    expect(typeof system?.content).toBe("string")
    return system?.content as string
  }

  it("injects owned project instructions and knowledge into the system context", async () => {
    mockPrisma.project.findFirst.mockResolvedValueOnce({
      description: null,
      id: "proj-1",
      instructions: "Sempre responda em pt-BR",
      name: "Projeto Alpha",
      userId: "user-1",
    })
    mockPrisma.projectFile.findMany.mockResolvedValueOnce([
      { extractedText: "Conteúdo do arquivo A", fileName: "a.pdf" },
      { extractedText: "Conteúdo do arquivo B", fileName: "b.md" },
    ])

    const messages = await resolveMessagesForProvider({
      config: demoConfig,
      credentials: {},
      messages: [{ content: "oi", role: "user" }],
      modelId: "demo-model",
      projectId: "proj-1",
      userId: "user-1",
    })

    const content = systemContent(messages)
    expect(content).toContain("Project instructions:\nSempre responda em pt-BR")
    expect(content).toContain(
      "Project knowledge:\n[a.pdf]\nConteúdo do arquivo A",
    )
    expect(content).toContain("[b.md]\nConteúdo do arquivo B")
    expect(messages[1]?.content).toBe("oi")
  })

  it("validates ownership with findFirst({ id, userId }) and ignores another user's project", async () => {
    // findFirst com o userId do solicitante não encontra projeto de outro usuário
    mockPrisma.project.findFirst.mockResolvedValueOnce(null)

    const messages = await resolveMessagesForProvider({
      config: demoConfig,
      credentials: {},
      messages: [{ content: "oi", role: "user" }],
      modelId: "demo-model",
      projectId: "proj-other",
      userId: "user-1",
    })

    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: "proj-other", userId: "user-1" },
    })
    expect(mockPrisma.projectFile.findMany).not.toHaveBeenCalled()
    // Sem settings/memories e sem projeto válido → nenhuma mensagem de sistema extra
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe("oi")
  })

  it("does not fetch project context when projectId is absent", async () => {
    const messages = await resolveMessagesForProvider({
      config: demoConfig,
      credentials: {},
      messages: [{ content: "oi", role: "user" }],
      modelId: "demo-model",
      userId: "user-1",
    })

    expect(messages).toHaveLength(1)
    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.projectFile.findMany).not.toHaveBeenCalled()
  })

  it("enforces instructions 20k cap and knowledge per-file 20k / total 60k caps", async () => {
    mockPrisma.project.findFirst.mockResolvedValueOnce({
      description: null,
      id: "proj-1",
      instructions: "i".repeat(25_000),
      name: "Projeto Alpha",
      userId: "user-1",
    })
    mockPrisma.projectFile.findMany.mockResolvedValueOnce([
      { extractedText: "x".repeat(25_000), fileName: "a.pdf" },
      { extractedText: "y".repeat(25_000), fileName: "b.pdf" },
      { extractedText: "z".repeat(25_000), fileName: "c.pdf" },
      { extractedText: "w".repeat(25_000), fileName: "d.pdf" },
    ])

    const messages = await resolveMessagesForProvider({
      config: demoConfig,
      credentials: {},
      messages: [{ content: "oi", role: "user" }],
      modelId: "demo-model",
      projectId: "proj-1",
      userId: "user-1",
    })

    const content = systemContent(messages)
    // instruções: 20k máx
    expect(content).toContain(`Project instructions:\n${"i".repeat(20_000)}`)
    expect(content).not.toContain("i".repeat(20_001))
    // knowledge: cada arquivo cortado a 20k e agregado a 60k (4º arquivo fica de fora)
    expect(content).toContain(`[a.pdf]\n${"x".repeat(20_000)}`)
    expect(content).toContain(`[b.pdf]\n${"y".repeat(20_000)}`)
    expect(content).toContain(`[c.pdf]\n${"z".repeat(20_000)}`)
    expect(content).not.toContain("[d.pdf]")
    expect(content).not.toContain("w".repeat(20_000))
  })

  it("reads x-modelhub-project-id header and injects project context via /api/chat", async () => {
    process.env.REQUIRE_AUTH = "true"
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({
      expiresAt: null,
      id: "key-1",
      userId: "user-1",
    })
    mockPrisma.project.findFirst.mockResolvedValueOnce({
      description: null,
      id: "proj-1",
      instructions: "Sempre responda em pt-BR",
      name: "Projeto Alpha",
      userId: "user-1",
    })
    mockPrisma.projectFile.findMany.mockResolvedValueOnce([
      { extractedText: "Conteúdo do arquivo A", fileName: "a.pdf" },
    ])

    const chat = vi.fn().mockResolvedValue(new Response("ok"))
    const app = createProviderApp({
      basePath: "/test-provider",
      chat,
      defaultModel: "demo-model",
      models: [
        {
          capabilities: { documents: true, images: false },
          id: "demo-model",
          name: "Demo Model",
        },
      ],
      providerId: "test-provider",
    })

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "oi", role: "user" }],
        modelId: "demo-model",
      }),
      headers: {
        authorization: "Bearer sk-test-123",
        "content-type": "application/json",
        "x-modelhub-project-id": "proj-1",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: "proj-1", userId: "user-1" },
    })
    const firstArg = chat.mock.calls[0]?.[0] as Array<{
      role: string
      content: string
    }>
    const content = systemContent(firstArg)
    expect(content).toContain("Project instructions:\nSempre responda em pt-BR")
    expect(content).toContain(
      "Project knowledge:\n[a.pdf]\nConteúdo do arquivo A",
    )
  })
})

async function readText(response: Response): Promise<string> {
  return response.text()
}

function extractOpenAiSseText(sse: string): string {
  let text = ""
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue
    const payload = JSON.parse(line.slice(6)) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    text += payload.choices?.[0]?.delta?.content ?? ""
  }
  return text
}

function extractVercelText(streamText: string): string {
  let text = ""
  for (const line of streamText.split("\n")) {
    if (!line.startsWith("0:")) continue
    text += JSON.parse(line.slice(2)) as string
  }
  return text
}

describe("hidden reasoning sanitization", () => {
  it("removes thought blocks from single text responses", async () => {
    const response = toVercelSingleTextResponse(
      "antes <thought>private</thought> depois",
    )

    await expect(readText(response)).resolves.toContain('0:"antes  depois"')
  })

  it("removes split thought blocks when converting Vercel stream to OpenAI SSE", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('0:"ok <tho"\n'))
        controller.enqueue(
          new TextEncoder().encode('0:"ught>private</thought> fim"\n'),
        )
        controller.enqueue(
          new TextEncoder().encode('d:{"finishReason":"stop"}\n'),
        )
        controller.close()
      },
    })

    const response = vercelStreamToOpenAiSse(new Response(stream), "demo/model")
    const body = await response.text()

    expect(extractOpenAiSseText(body)).toBe("ok  fim")
    expect(body).not.toContain("private")
    expect(body).not.toContain("<thought>")
  })

  it("removes thought blocks when converting upstream OpenAI SSE to Vercel stream", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"a <think>hidden"}}]}',
      'data: {"choices":[{"delta":{"content":" still hidden</think> b"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n")

    const response = toVercelStreamFromOpenAiSse(new Response(upstream))
    const body = await response.text()

    expect(extractVercelText(body)).toBe("a  b")
    expect(body).not.toContain("hidden")
    expect(body).toContain('d:{"finishReason":"stop"}')
  })

  it("does not buffer normal words that start with hidden tag names", async () => {
    const response = toVercelSingleTextResponse(
      "I am <thinking> about a thoughtful answer.",
    )

    await expect(readText(response)).resolves.toContain(
      '0:"I am <thinking> about a thoughtful answer."',
    )
  })

  it("does not treat unsupported closing tags as pending forever inside hidden blocks", async () => {
    const upstream = [
      'data: {"choices":[{"delta":{"content":"visible <think>hidden </thinking> still hidden"}}]}',
      'data: {"choices":[{"delta":{"content":"</think> done"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n")

    const response = toVercelStreamFromOpenAiSse(new Response(upstream))
    const body = await response.text()

    expect(extractVercelText(body)).toBe("visible  done")
    expect(body).not.toContain("hidden")
    expect(body).toContain('d:{"finishReason":"stop"}')
  })
})
