import { describe, expect, it, vi } from "vitest";

import { parseChatStream } from "./chat-stream";

function createStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });

  return new Response(stream);
}

describe("parseChatStream", () => {
  it("parses text deltas and tool events from mixed payloads", async () => {
    const onTextDelta = vi.fn();
    const onToolStart = vi.fn();
    const onToolResult = vi.fn();

    const response = createStreamResponse([
      '0:"Ol"\n',
      '0:"á"\n',
      '9:{"toolCallId":"tool-1","toolName":"search","args":{"q":"test"}}\n',
      'a:{"toolCallId":"tool-1","result":{"ok":true}}\n',
      'data: {"type":"text-delta","delta":" mundo"}\n',
    ]);

    const parsed = await parseChatStream(response, {
      onTextDelta,
      onToolResult,
      onToolStart,
    });

    expect(parsed).toEqual({
      errorMessage: undefined,
      hadPartialOutput: true,
      text: "Olá mundo",
    });
    expect(onTextDelta).toHaveBeenCalledTimes(3);
    expect(onToolStart).toHaveBeenCalledWith({
      args: { q: "test" },
      status: "running",
      toolCallId: "tool-1",
      toolName: "search",
    });
    expect(onToolResult).toHaveBeenCalledWith("tool-1", { ok: true });
  });

  it("reports output truncation from OpenAI finish_reason length", async () => {
    const response = createStreamResponse([
      'data: {"choices":[{"delta":{"content":"Parcial"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
      'data: [DONE]\n',
    ]);

    const parsed = await parseChatStream(response, {});

    expect(parsed).toEqual({
      errorMessage: undefined,
      finishReason: "length",
      hadPartialOutput: true,
      text: "Parcial",
    });
  });

  it("reports output truncation from Vercel finishReason length", async () => {
    const response = createStreamResponse([
      '0:"Parcial"\n',
      'd:{"finishReason":"length"}\n',
    ]);

    const parsed = await parseChatStream(response, {});

    expect(parsed.finishReason).toBe("length");
  });

  it("captures stream errors without discarding partial text", async () => {
    const response = createStreamResponse([
      '0:"Parcial"\n',
      '3:"ERR_CHALLENGE"\n',
      'd:{"finishReason":"error"}\n',
    ]);

    const parsed = await parseChatStream(response, {});

    expect(parsed).toEqual({
      errorMessage: "ERR_CHALLENGE",
      finishReason: "error",
      hadPartialOutput: true,
      text: "Parcial",
    });
  });
});
