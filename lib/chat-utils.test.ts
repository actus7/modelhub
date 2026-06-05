import { describe, expect, it } from "vitest";

import type { ProviderModel } from "@/lib/contracts";
import {
  buildAttachmentLabel,
  buildUserMessageParts,
  createTextPart,
  DUCKAI_TEMPORARY_INLINE_MESSAGE,
  formatMessageTimestamp,
  getUserMessageText,
  hydrateChatMessage,
  parseApiErrorResponse,
  resolveAssistantModelLabel,
  resolveModelFallbackFromHeaders,
  resolveModelSelectPlaceholder,
  resolveStreamErrorContent,
  STREAM_INTERRUPTED_NOTE,
} from "./chat-utils";

const MODELS: ProviderModel[] = [
  { capabilities: { documents: true, images: false }, id: "gpt-4o", name: "GPT-4o" },
  { capabilities: { documents: true, images: true }, id: "gpt-4o-mini", name: "GPT-4o mini" },
];

function makeResponse(headers: Record<string, string>): Response {
  return new Response(null, { headers });
}

describe("resolveAssistantModelLabel", () => {
  it("resolves a known model id to its name with provider suffix", () => {
    expect(resolveAssistantModelLabel({ modelId: "gpt-4o", models: MODELS, providerLabel: "OpenAI" })).toBe(
      "GPT-4o (OpenAI)",
    );
  });

  it("falls back to the raw id when the model is unknown", () => {
    expect(resolveAssistantModelLabel({ modelId: "mystery", models: MODELS, providerLabel: "OpenAI" })).toBe(
      "mystery (OpenAI)",
    );
  });

  it("does not duplicate the provider suffix when already present", () => {
    const models: ProviderModel[] = [
      { capabilities: { documents: false, images: false }, id: "x", name: "Cool Model (OpenAI)" },
    ];
    expect(resolveAssistantModelLabel({ modelId: "x", models, providerLabel: "OpenAI" })).toBe("Cool Model (OpenAI)");
  });

  it("returns the provider label when there is no model id", () => {
    expect(resolveAssistantModelLabel({ models: MODELS, providerLabel: "OpenAI" })).toBe("OpenAI");
  });
});

describe("resolveModelFallbackFromHeaders", () => {
  it("returns the default label and no fallback meta when headers are absent", () => {
    const { resolvedLabel, fallbackMeta } = resolveModelFallbackFromHeaders(
      makeResponse({}),
      "Default Label",
      MODELS,
      "OpenAI",
    );
    expect(resolvedLabel).toBe("Default Label");
    expect(fallbackMeta).toBeUndefined();
  });

  it("builds fallback meta when a model swap happened", () => {
    const { resolvedLabel, fallbackMeta } = resolveModelFallbackFromHeaders(
      makeResponse({
        "x-modelhub-effective-model": "gpt-4o-mini",
        "x-modelhub-requested-model": "gpt-4o",
        "x-modelhub-model-fallback-used": "true",
        "x-modelhub-models-attempted": "gpt-4o, gpt-4o-mini",
      }),
      "Default Label",
      MODELS,
      "OpenAI",
    );
    expect(resolvedLabel).toBe("GPT-4o mini (OpenAI)");
    expect(fallbackMeta).toEqual({
      requestedLabel: "GPT-4o (OpenAI)",
      effectiveLabel: "GPT-4o mini (OpenAI)",
      attemptedIds: ["gpt-4o", "gpt-4o-mini"],
    });
  });

  it("omits fallback meta when fallback flag is not 'true'", () => {
    const { fallbackMeta } = resolveModelFallbackFromHeaders(
      makeResponse({
        "x-modelhub-effective-model": "gpt-4o-mini",
        "x-modelhub-requested-model": "gpt-4o",
        "x-modelhub-models-attempted": "gpt-4o,gpt-4o-mini",
      }),
      "Default Label",
      MODELS,
      "OpenAI",
    );
    expect(fallbackMeta).toBeUndefined();
  });
});

describe("resolveStreamErrorContent", () => {
  it("returns null when there is no error message", () => {
    expect(resolveStreamErrorContent({ hadPartialOutput: false, text: "" }, "", "openai")).toBeNull();
  });

  it("appends the interrupted note when there was partial output", () => {
    expect(
      resolveStreamErrorContent({ errorMessage: "boom", hadPartialOutput: true, text: "partial" }, "partial", "openai"),
    ).toBe(`partial${STREAM_INTERRUPTED_NOTE}`);
  });

  it("returns the duckai inline message for the duckai provider", () => {
    expect(
      resolveStreamErrorContent({ errorMessage: "boom", hadPartialOutput: false, text: "" }, "", "duckai"),
    ).toBe(DUCKAI_TEMPORARY_INLINE_MESSAGE);
  });

  it("returns a generic error for other providers", () => {
    expect(
      resolveStreamErrorContent({ errorMessage: "boom", hadPartialOutput: false, text: "" }, "", "openai"),
    ).toBe("Erro: boom");
  });
});

describe("createTextPart / buildUserMessageParts", () => {
  it("creates an empty array for empty text", () => {
    expect(createTextPart("")).toEqual([]);
  });

  it("creates a single text part for non-empty text", () => {
    expect(createTextPart("hi")).toEqual([{ text: "hi", type: "text" }]);
  });

  it("combines text and attachment parts, mapping id to attachmentId", () => {
    const parts = buildUserMessageParts("hello", [
      {
        byteSize: 10,
        contentUrl: "/c/1",
        extractionStatus: "completed",
        fileName: "a.pdf",
        id: "att-1",
        kind: "document",
        mimeType: "application/pdf",
      },
    ]);
    expect(parts[0]).toEqual({ text: "hello", type: "text" });
    expect(parts[1]).toMatchObject({ attachmentId: "att-1", id: "att-1", type: "attachment" });
  });
});

describe("getUserMessageText", () => {
  it("returns content when there are no parts", () => {
    expect(getUserMessageText({ content: "raw text" })).toBe("raw text");
  });

  it("extracts text from parts when present", () => {
    expect(
      getUserMessageText({ content: "ignored", parts: [{ text: "from parts", type: "text" }] }),
    ).toBe("from parts");
  });
});

describe("hydrateChatMessage", () => {
  it("keeps assistant content and applies the model label", () => {
    const message = hydrateChatMessage({
      assistantModelLabel: "GPT-4o (OpenAI)",
      message: { content: "answer", id: "m1", parts: [], role: "assistant" },
    });
    expect(message).toMatchObject({ content: "answer", id: "m1", modelLabel: "GPT-4o (OpenAI)", role: "assistant" });
    expect(message.parts).toBeUndefined();
  });

  it("derives user text from parts and keeps parts", () => {
    const message = hydrateChatMessage({
      message: { content: "", id: "m2", parts: [{ text: "user msg", type: "text" }], role: "user" },
    });
    expect(message.content).toBe("user msg");
    expect(message.modelLabel).toBeUndefined();
    expect(message.parts).toHaveLength(1);
  });
});

describe("buildAttachmentLabel", () => {
  it("labels images", () => {
    expect(buildAttachmentLabel({ extractionStatus: "completed", kind: "image" })).toBe("Imagem");
  });

  it("labels documents by extraction status", () => {
    expect(buildAttachmentLabel({ extractionStatus: "completed", kind: "document" })).toBe("Documento indexado");
    expect(buildAttachmentLabel({ extractionStatus: "unsupported_scan", kind: "document" })).toBe("Scan sem OCR");
    expect(buildAttachmentLabel({ extractionStatus: "processing", kind: "document" })).toBe("Processando");
    expect(buildAttachmentLabel({ extractionStatus: "failed", kind: "document" })).toBe("Documento sem texto");
  });
});

describe("resolveModelSelectPlaceholder", () => {
  it("covers the three branches", () => {
    expect(resolveModelSelectPlaceholder({ hasModels: false, providerReady: true })).toBe("Sem modelo");
    expect(resolveModelSelectPlaceholder({ hasModels: true, providerReady: true })).toBe("Modelo");
    expect(resolveModelSelectPlaceholder({ hasModels: true, providerReady: false })).toBe("Credenciais…");
  });
});

describe("formatMessageTimestamp", () => {
  it("formats a same-day timestamp as time only", () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    const formatted = formatMessageTimestamp(today.toISOString());
    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
  });

  it("includes the date for a different day", () => {
    const formatted = formatMessageTimestamp("2020-01-15T09:05:00.000Z");
    expect(formatted).toMatch(/\d{2}\/\d{2}\s\d{2}:\d{2}/);
  });
});

describe("parseApiErrorResponse", () => {
  it("extracts a string error field", async () => {
    expect(await parseApiErrorResponse(Response.json({ error: "nope" }))).toBe("nope");
  });

  it("extracts a nested error message", async () => {
    expect(await parseApiErrorResponse(Response.json({ error: { message: "deep" } }))).toBe("deep");
  });

  it("falls back to the HTTP status when there is no error field", async () => {
    expect(await parseApiErrorResponse(new Response("", { status: 503 }))).toBe("HTTP 503");
  });

  it("falls back without throwing when the JSON payload is null", async () => {
    expect(await parseApiErrorResponse(Response.json(null, { status: 500 }))).toBe("HTTP 500");
  });

  it("falls back without throwing when the JSON payload is not an object", async () => {
    expect(await parseApiErrorResponse(Response.json("boom", { status: 502 }))).toBe("HTTP 502");
  });
});
