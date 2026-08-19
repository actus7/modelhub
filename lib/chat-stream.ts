import type { StreamEvent } from "@/lib/contracts";

export type ParsedToolCall = {
  approvalId?: string;
  args: unknown;
  requiresApproval?: boolean;
  result?: unknown;
  status: "completed" | "pending-approval" | "running";
  toolCallId: string;
  toolName: string;
};

export type ParsedChatStreamResult = {
  errorMessage?: string;
  finishReason?: string;
  hadPartialOutput: boolean;
  text: string;
};

type ParseStreamHandlers = {
  onEvent?: (event: StreamEvent) => void;
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolCall: ParsedToolCall) => void;
  onToolResult?: (toolCallId: string, result: unknown) => void;
};

type LineProcessorState = {
  errorMessage?: string;
  finishReason?: string;
  fullText: string;
  openAiToolCalls: Map<
    number,
    { arguments: string; emitted: boolean; id: string; name: string }
  >;
};

function emitTextDelta(delta: string, handlers: ParseStreamHandlers, state: LineProcessorState) {
  state.fullText += delta;
  handlers.onEvent?.({ delta, type: "text-delta" });
  handlers.onTextDelta?.(delta);
}

function emitToolStart(
  toolCallId: string,
  toolName: string,
  args: unknown,
  handlers: ParseStreamHandlers,
) {
  handlers.onEvent?.({ args, toolCallId, toolName, type: "tool-start" });
  handlers.onToolStart?.({ args, status: "running", toolCallId, toolName });
}

function emitToolResult(
  toolCallId: string,
  result: unknown,
  handlers: ParseStreamHandlers,
) {
  handlers.onEvent?.({ result, toolCallId, type: "tool-result" });
  handlers.onToolResult?.(toolCallId, result);
}

function processVercelStreamLine(line: string, handlers: ParseStreamHandlers, state: LineProcessorState): boolean {
  if (line.startsWith("0:")) {
    emitTextDelta(JSON.parse(line.slice(2)) as string, handlers, state);
    return true;
  }

  if (line.startsWith("9:")) {
    const payload = JSON.parse(line.slice(2)) as {
      args?: unknown;
      toolCallId: string;
      toolName: string;
    };
    emitToolStart(payload.toolCallId, payload.toolName, payload.args ?? {}, handlers);
    return true;
  }

  if (line.startsWith("a:")) {
    const payload = JSON.parse(line.slice(2)) as {
      result?: unknown;
      toolCallId: string;
    };
    emitToolResult(payload.toolCallId, payload.result ?? null, handlers);
    return true;
  }

  if (line.startsWith("3:")) {
    state.errorMessage = JSON.parse(line.slice(2)) as string;
    return true;
  }

  if (line.startsWith("d:")) {
    const payload = JSON.parse(line.slice(2)) as { finishReason?: string };
    if (payload.finishReason && payload.finishReason !== "stop") {
      state.finishReason = payload.finishReason;
    }
    return true;
  }

  return false;
}

function extractDeltaText(delta: Record<string, unknown>): string {
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return (delta.content as Array<{ text?: string }>)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processInternalSsePayload(payload: Record<string, any>, handlers: ParseStreamHandlers, state: LineProcessorState): boolean {
  if (payload.type === "text-delta" && payload.delta) {
    emitTextDelta(payload.delta as string, handlers, state);
    return true;
  }

  if (payload.type === "tool-call" && payload.toolCallId && payload.toolName) {
    emitToolStart(
      payload.toolCallId as string,
      payload.toolName as string,
      (payload.args as Record<string, unknown>) ?? {},
      handlers,
    );
    return true;
  }

  if (payload.type === "tool-result" && payload.toolCallId) {
    emitToolResult(
      payload.toolCallId as string,
      (payload.result as unknown) ?? null,
      handlers,
    );
    return true;
  }

  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processRawOpenAiChoices(payload: Record<string, any>, handlers: ParseStreamHandlers, state: LineProcessorState) {
  if (!Array.isArray(payload.choices)) return;

  const choice = payload.choices[0];
  if (typeof choice?.finish_reason === "string" && choice.finish_reason !== "stop") {
    state.finishReason = choice.finish_reason;
  }

  const delta = choice?.delta;
  if (!delta) return;

  if (Array.isArray(delta.tool_calls)) {
    for (const rawToolCall of delta.tool_calls) {
      const index =
        typeof rawToolCall?.index === "number"
          ? rawToolCall.index
          : state.openAiToolCalls.size;
      const current = state.openAiToolCalls.get(index) ?? {
        arguments: "",
        emitted: false,
        id: "",
        name: "",
      };
      if (typeof rawToolCall?.id === "string") current.id = rawToolCall.id;
      if (typeof rawToolCall?.function?.name === "string") {
        current.name += rawToolCall.function.name;
      }
      if (typeof rawToolCall?.function?.arguments === "string") {
        current.arguments += rawToolCall.function.arguments;
      }
      state.openAiToolCalls.set(index, current);
    }
  }

  if (choice?.finish_reason && state.openAiToolCalls.size > 0) {
    for (const [index, toolCall] of state.openAiToolCalls) {
      if (toolCall.emitted || !toolCall.name) continue;
      let args: unknown = {};
      try {
        args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
      } catch {
        args = { _raw: toolCall.arguments };
      }
      emitToolStart(
        toolCall.id || `tool_${index}`,
        toolCall.name,
        args,
        handlers,
      );
      toolCall.emitted = true;
    }
  }

  const text = extractDeltaText(delta);
  if (text) emitTextDelta(text, handlers, state);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processOpenAiSseLine(payload: Record<string, any>, handlers: ParseStreamHandlers, state: LineProcessorState) {
  if (!processInternalSsePayload(payload, handlers, state)) {
    processRawOpenAiChoices(payload, handlers, state);
  }
}

function processLine(line: string, handlers: ParseStreamHandlers, state: LineProcessorState) {
  if (processVercelStreamLine(line, handlers, state)) {
    return;
  }

  if (line.startsWith("data: ")) {
    const dataContent = line.slice(6).trim();
    if (dataContent === "[DONE]") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processOpenAiSseLine(JSON.parse(dataContent) as Record<string, any>, handlers, state);
  }
}

export async function parseChatStream(
  response: Response,
  handlers: ParseStreamHandlers,
): Promise<ParsedChatStreamResult> {
  if (!response.body) {
    throw new Error("A resposta veio sem stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: LineProcessorState = {
    fullText: "",
    openAiToolCalls: new Map(),
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line) processLine(line, handlers, state);
    }
  }

  buffer += decoder.decode();
  const finalLine = buffer.trim();
  if (finalLine) processLine(finalLine, handlers, state);

  return {
    errorMessage: state.errorMessage,
    ...(state.finishReason ? { finishReason: state.finishReason } : {}),
    hadPartialOutput: state.fullText.length > 0,
    text: state.fullText,
  };
}
