import { parseChatStream } from "../../lib/chat-stream"
import type { HarnessToolCall } from "../../lib/harness/contracts"

export type HarnessModelResult = {
  finishReason: string
  routing?: {
    modelId: string
    providerId: string
    tier: string | null
  }
  text: string
  toolCalls: HarnessToolCall[]
}

export function isModelOutputLimitFinishReason(finishReason: string): boolean {
  return /^(?:length|max[_-]?(?:output[_-]?)?tokens?|token[_-]?limit)$/i.test(
    finishReason.trim(),
  )
}

export async function consumeHarnessModelResponse(
  response: Response,
  onTextDelta?: (delta: string) => void | Promise<void>,
): Promise<HarnessModelResult> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Model request failed with HTTP ${response.status}`)
  }

  const toolCalls = new Map<string, HarnessToolCall>()
  let pendingDeltaWrites = Promise.resolve()
  const parsed = await parseChatStream(response, {
    onTextDelta(delta) {
      pendingDeltaWrites = pendingDeltaWrites.then(() => onTextDelta?.(delta))
    },
    onToolStart(toolCall) {
      toolCalls.set(toolCall.toolCallId, {
        args:
          typeof toolCall.args === "object" && toolCall.args !== null && !Array.isArray(toolCall.args)
            ? (toolCall.args as Record<string, unknown>)
            : {},
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
      })
    },
  })
  await pendingDeltaWrites

  if (parsed.errorMessage) throw new Error(parsed.errorMessage)
  const routingProviderId = response.headers.get("x-modelhub-provider")
  const routingModelId = response.headers.get("x-modelhub-model")
  return {
    finishReason: parsed.finishReason ?? (toolCalls.size > 0 ? "tool-calls" : "stop"),
    ...(routingProviderId && routingModelId
      ? {
          routing: {
            modelId: routingModelId,
            providerId: routingProviderId,
            tier: response.headers.get("x-modelhub-tier"),
          },
        }
      : {}),
    text: parsed.text,
    toolCalls: [...toolCalls.values()],
  }
}
