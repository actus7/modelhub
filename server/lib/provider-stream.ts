/**
 * Conversões de stream entre o SSE OpenAI (upstream), o protocolo de stream
 * interno consumido pelo chat e o SSE OpenAI devolvido em /v1.
 */

import { logger } from "./logger";

type OpenAiSseContentPart = {
  text?: string;
};

type OpenAiSseToolCallDelta = {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiSseChunk = {
  choices?: Array<{
    delta?: {
      content?: string | OpenAiSseContentPart[];
      tool_calls?: OpenAiSseToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
};

type AccumulatedToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function extractSseTextDelta(parsed: OpenAiSseChunk | null): string {
  const delta = parsed?.choices?.[0]?.delta;
  if (!delta) return "";

  if (typeof delta.content === "string") {
    return delta.content;
  }

  if (Array.isArray(delta.content)) {
    return delta.content.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
  }

  return "";
}

async function writeFinish(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reason = "stop",
  usage?: { promptTokens: number; completionTokens: number },
): Promise<void> {
  const encoder = new TextEncoder();
  const payload: Record<string, unknown> = { finishReason: reason };
  if (usage) {
    payload.usage = usage;
  }
  await writer.write(encoder.encode(`d:${JSON.stringify(payload)}\n`));
}

function logParsingIssue(context: string, error: unknown): void {
  logger.debug("provider.parsing_issue", { context, error });
}

function accumulateToolCallDeltas(
  deltas: OpenAiSseToolCallDelta[],
  accumulated: Map<number, AccumulatedToolCall>,
): void {
  for (const tc of deltas) {
    const existing = accumulated.get(tc.index);
    if (existing) {
      if (tc.function?.arguments) {
        existing.function.arguments += tc.function.arguments;
      }
    } else {
      accumulated.set(tc.index, {
        id: tc.id || "",
        type: "function",
        function: {
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "",
        },
      });
    }
  }
}

async function flushAccumulatedToolCalls(
  accumulated: Map<number, AccumulatedToolCall>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  const encoder = new TextEncoder();
  for (const [, tc] of accumulated) {
    if (!tc.id || !tc.function.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      // arguments may be empty or invalid — send as-is string wrapped
      args = { _raw: tc.function.arguments };
    }
    const payload = { toolCallId: tc.id, toolName: tc.function.name, args };
    await writer.write(encoder.encode(`9:${JSON.stringify(payload)}\n`));
  }
  accumulated.clear();
}

async function processSseLine(
  lineRaw: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  toolCallAccumulator: Map<number, AccumulatedToolCall>,
  usageAccumulator: {
    value: { promptTokens: number; completionTokens: number } | null;
  },
): Promise<boolean> {
  const encoder = new TextEncoder();
  const line = lineRaw.trim();
  if (!line.startsWith("data:")) return false;

  const data = line.slice(5).trim();
  if (!data) return false;

  if (data === "[DONE]") {
    await flushAccumulatedToolCalls(toolCallAccumulator, writer);
    await writeFinish(writer, "stop", usageAccumulator.value ?? undefined);
    return true;
  }

  try {
    const parsed = JSON.parse(data) as OpenAiSseChunk;
    const token = extractSseTextDelta(parsed);
    if (token) {
      await writer.write(encoder.encode(`0:${JSON.stringify(token)}\n`));
    }

    const toolCallDeltas = parsed.choices?.[0]?.delta?.tool_calls;
    if (toolCallDeltas && Array.isArray(toolCallDeltas)) {
      accumulateToolCallDeltas(toolCallDeltas, toolCallAccumulator);
    }

    // Capture usage from chunks that carry it (sent when stream_options.include_usage=true)
    const usageRaw = (parsed as Record<string, unknown>).usage as
      Record<string, unknown> | undefined;
    if (usageRaw && typeof usageRaw.prompt_tokens === "number") {
      usageAccumulator.value = {
        promptTokens: usageRaw.prompt_tokens as number,
        completionTokens: (usageRaw.completion_tokens as number | undefined) ?? 0,
      };
    }

    const finishReason = parsed.choices?.[0]?.finish_reason;
    if (finishReason && finishReason !== "null") {
      await flushAccumulatedToolCalls(toolCallAccumulator, writer);
      await writeFinish(
        writer,
        finishReason === "tool_calls" ? "tool-calls" : finishReason,
        usageAccumulator.value ?? undefined,
      );
      return true;
    }
  } catch (error) {
    logParsingIssue("Ignoring malformed upstream SSE chunk.", error);
  }

  return false;
}

export function toVercelStreamFromOpenAiSse(
  upstream: Response,
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void,
): Response {
  const decoder = new TextDecoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const toolCallAccumulator = new Map<number, AccumulatedToolCall>();
  const usageAccumulator: {
    value: { promptTokens: number; completionTokens: number } | null;
  } = { value: null };

  (async () => {
    let didFinish = false;
    try {
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error("Upstream response has no body stream");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const lineRaw of lines) {
          didFinish =
            (await processSseLine(lineRaw, writer, toolCallAccumulator, usageAccumulator)) ||
            didFinish;
        }
      }

      if (!didFinish) {
        await flushAccumulatedToolCalls(toolCallAccumulator, writer);
        await writeFinish(writer, "stop", usageAccumulator.value ?? undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(`3:${JSON.stringify(message)}\n`));
      await writeFinish(writer, "error");
    } finally {
      if (usageAccumulator.value && onUsage) {
        onUsage(usageAccumulator.value);
      }
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}

export function toVercelSingleTextResponse(text: string): Response {
  const payload = `0:${JSON.stringify(text)}\nd:{"finishReason":"stop"}\n`;
  return new Response(payload, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

export function toVercelToolCallsResponse(
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>,
  textContent?: string,
): Response {
  let payload = "";
  if (textContent) {
    payload += `0:${JSON.stringify(textContent)}\n`;
  }
  for (const tc of toolCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      args = { _raw: tc.function.arguments };
    }
    payload += `9:${JSON.stringify({ toolCallId: tc.id, toolName: tc.function.name, args })}\n`;
  }
  payload += `d:{"finishReason":"tool-calls"}\n`;
  return new Response(payload, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Convert a Vercel AI SDK stream response to OpenAI-compatible SSE format.
 * Vercel format: `0:"text"\n`, `9:{toolCall}\n`, `d:{"finishReason":"stop"}\n`
 * OpenAI format: `data: {"choices":[{"delta":{"content":"text"}}]}\n\n`
 */
export function vercelStreamToOpenAiSse(vercelResponse: Response, model: string): Response {
  // Pass through non-2xx responses as OpenAI-compatible error JSON
  if (!vercelResponse.ok) {
    return vercelResponse;
  }

  const chatId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // Non-streaming: collect full body and return as single JSON
  if (!vercelResponse.body) {
    return toOpenAiNonStreamingResponse(vercelResponse, model, chatId, created);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      const reader = vercelResponse.body!.getReader();
      let buffer = "";
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) continue;
          const colonIdx = line.indexOf(":");
          if (colonIdx < 0) continue;

          const prefix = line.substring(0, colonIdx);
          const payload = line.substring(colonIdx + 1);

          if (prefix === "0") {
            // Text chunk
            const text = JSON.parse(payload) as string;
            if (!text) continue;
            const chunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: text },
                  finish_reason: null,
                },
              ],
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          } else if (prefix === "9") {
            // Tool call
            const tc = JSON.parse(payload) as {
              toolCallId: string;
              toolName: string;
              args: unknown;
            };
            toolCalls.push({
              id: tc.toolCallId,
              type: "function",
              function: {
                name: tc.toolName,
                arguments: JSON.stringify(tc.args),
              },
            });
          } else if (prefix === "d") {
            // Finish
            const data = JSON.parse(payload) as {
              finishReason: string;
              usage?: { promptTokens: number; completionTokens: number };
            };
            const finishReason =
              data.finishReason === "tool-calls" ? "tool_calls" : data.finishReason;
            const delta: Record<string, unknown> = {};
            if (toolCalls.length > 0) {
              delta.tool_calls = toolCalls.map((tc, i) => ({ index: i, ...tc }));
            }
            const chunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finishReason }],
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            // Emit usage chunk if available (OpenAI stream_options.include_usage format)
            if (data.usage) {
              const usageChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [],
                usage: {
                  prompt_tokens: data.usage.promptTokens,
                  completion_tokens: data.usage.completionTokens,
                  total_tokens: data.usage.promptTokens + data.usage.completionTokens,
                },
              };
              await writer.write(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
            }
            await writer.write(encoder.encode("data: [DONE]\n\n"));
          } else if (prefix === "3") {
            // Error
            const errMsg = JSON.parse(payload) as string;
            const chunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: `[Error: ${errMsg}]` },
                  finish_reason: null,
                },
              ],
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        }
      }
    } catch {
      // Stream ended unexpectedly — send DONE to close cleanly
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: vercelResponse.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function toOpenAiNonStreamingResponse(
  vercelResponse: Response,
  model: string,
  chatId: string,
  created: number,
): Response {
  const body = {
    id: chatId,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "" },
        finish_reason: "stop",
      },
    ],
  };
  return new Response(JSON.stringify(body), {
    status: vercelResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}
