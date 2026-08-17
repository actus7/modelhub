import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildExportFilename,
  conversationToJson,
  conversationToMarkdown,
} from "./conversation-export";

describe("conversationToMarkdown", () => {
  it("renderiza mensagens com rótulos de papel e separador", () => {
    const md = conversationToMarkdown(null, [
      { content: "olá", role: "user" },
      { content: "oi! posso ajudar?", role: "assistant" },
    ]);

    expect(md).toBe("## Você\n\nolá\n\n---\n\n## Assistente\n\noi! posso ajudar?");
  });

  it("inclui cabeçalho com título quando a conversa possui um", () => {
    const md = conversationToMarkdown(
      { title: "Revisão de código" },
      [{ content: "olá", role: "user" }],
    );

    expect(md).toBe("# Revisão de código\n\n## Você\n\nolá");
  });

  it("ignora título vazio ou só de espaços", () => {
    expect(conversationToMarkdown({ title: "   " }, [{ content: "x", role: "user" }])).toBe(
      "## Você\n\nx",
    );
  });

  it("mapeia system e papéis desconhecidos de forma legível", () => {
    const md = conversationToMarkdown(null, [
      { content: "contexto", role: "system" },
      { content: "dados", role: "tool" },
    ]);

    expect(md).toBe("## Sistema\n\ncontexto\n\n---\n\n## Tool\n\ndados");
  });
});

describe("conversationToJson", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializa metadados, timestamp de exportação e mensagens", () => {
    const json = JSON.parse(
      conversationToJson(
        {
          createdAt: "2026-08-01T10:00:00.000Z",
          id: "conv-1",
          modelId: "llama3.2",
          providerId: "ollama",
          title: "Teste",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        [
          {
            content: "olá",
            createdAt: "2026-08-01T10:01:00.000Z",
            id: "msg-1",
            role: "user",
          },
        ],
      ),
    );

    expect(json.exportedAt).toBe("2026-08-17T12:00:00.000Z");
    expect(json.conversation).toEqual({
      createdAt: "2026-08-01T10:00:00.000Z",
      id: "conv-1",
      modelId: "llama3.2",
      providerId: "ollama",
      title: "Teste",
      updatedAt: "2026-08-02T10:00:00.000Z",
    });
    expect(json.messages).toEqual([
      {
        content: "olá",
        createdAt: "2026-08-01T10:01:00.000Z",
        id: "msg-1",
        modelLabel: null,
        role: "user",
      },
    ]);
  });

  it("usa null para metadados ausentes", () => {
    const json = JSON.parse(conversationToJson(null, [{ content: "x", role: "user" }]));

    expect(json.conversation).toEqual({
      createdAt: null,
      id: null,
      modelId: null,
      providerId: null,
      title: null,
      updatedAt: null,
    });
    expect(json.messages[0].id).toBeNull();
  });
});

describe("buildExportFilename", () => {
  it("normaliza título com acentos, espaços e maiúsculas", () => {
    expect(buildExportFilename("Revisão de Código — API", "md")).toBe("revisao-de-codigo-api.md");
  });

  it("remove prefixo título: herdado da geração automática", () => {
    expect(buildExportFilename("título: Integração com OpenAI", "json")).toBe(
      "integracao-com-openai.json",
    );
  });

  it("cai para o fallback datado quando não há título útil", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    expect(buildExportFilename(null, "md")).toBe("conversa-2026-08-17.md");
    expect(buildExportFilename("---", "json")).toBe("conversa-2026-08-17.json");

    vi.useRealTimers();
  });
});
