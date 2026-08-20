import type { HarnessEvent, HarnessRunStatus } from "./contracts"

export type HarnessStreamResult = {
  assistantMessageId?: string
  replaceText?: boolean
  runId?: string
  status: HarnessRunStatus
  text: string
}

export class HarnessRunBusyError extends Error {
  readonly code = "HARNESS_RUN_BUSY"

  constructor(
    readonly runId: string,
    readonly retryAfterMs: number | null,
  ) {
    super("A geração continua ativa no servidor. Tentando reconectar…")
    this.name = "HarnessRunBusyError"
  }
}

export class HarnessActiveRunError extends Error {
  readonly code = "HARNESS_ACTIVE_RUN"

  constructor(
    readonly runId: string,
    readonly runStatus: string,
    readonly retryAfterMs: number | null,
  ) {
    super(
      runStatus === "waiting_approval"
        ? "A geração anterior está aguardando uma aprovação. Resolva ou cancele essa execução antes de enviar outra mensagem."
        : "Esta conversa ainda possui uma geração ativa. Aguarde a conclusão ou cancele a execução antes de enviar outra mensagem.",
    )
    this.name = "HarnessActiveRunError"
  }
}

async function harnessResponseError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => "")
  let payload: Record<string, unknown> | null = null
  try {
    payload = detail ? JSON.parse(detail) as Record<string, unknown> : null
  } catch {
    // Preserve non-JSON upstream errors below.
  }
  if (
    response.status === 409 &&
    payload?.code === "HARNESS_ACTIVE_RUN" &&
    typeof payload.runId === "string" &&
    typeof payload.status === "string"
  ) {
    return new HarnessActiveRunError(
      payload.runId,
      payload.status,
      typeof payload.retryAfterMs === "number" ? payload.retryAfterMs : null,
    )
  }
  if (
    response.status === 409 &&
    payload?.code === "HARNESS_RUN_BUSY" &&
    typeof payload.runId === "string"
  ) {
    return new HarnessRunBusyError(
      payload.runId,
      typeof payload.retryAfterMs === "number" ? payload.retryAfterMs : null,
    )
  }
  const message = typeof payload?.error === "string"
    ? payload.error
    : detail || `Harness request failed with HTTP ${response.status}`
  return new Error(message)
}

export async function consumeHarnessStream(
  response: Response,
  onEvent?: (event: HarnessEvent) => void | Promise<void>,
): Promise<HarnessStreamResult> {
  if (!response.ok) {
    throw await harnessResponseError(response)
  }
  if (!response.body) throw new Error("The harness response has no event stream")

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let assistantMessageId: string | undefined
  let runId: string | undefined
  let status: HarnessRunStatus = "running"
  let text = ""
  let replaceText = false
  let runError: string | undefined

  const processBlock = async (block: string) => {
    const lines = block.split(/\r?\n/)
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim()
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    if (!data) return
    if (eventName === "error") {
      const payload = JSON.parse(data) as { message?: string }
      throw new Error(payload.message ?? "Harness stream failed")
    }

    const event = JSON.parse(data) as HarnessEvent
    runId = event.runId ?? runId
    if (event.type === "assistant/chunk" && event.payload.live === true && typeof event.payload.delta === "string") {
      text += event.payload.delta
    }
    if (event.type === "assistant/message" && typeof event.payload.messageId === "string") {
      assistantMessageId = event.payload.messageId
      if (event.payload.replaySnapshot === true && typeof event.payload.content === "string") {
        text = event.payload.content
        replaceText = true
      } else if (!text && typeof event.payload.content === "string") {
        text = event.payload.content
      }
    }
    if (event.type === "run/status" && typeof event.payload.status === "string") {
      status = event.payload.status as HarnessRunStatus
    }
    if (event.type === "run/error" && typeof event.payload.message === "string") {
      runError = event.payload.message
    }
    await onEvent?.(event)
  }

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ""
    for (const block of blocks) await processBlock(block)
  }
  buffer += decoder.decode()
  if (buffer.trim()) await processBlock(buffer)

  if ((status as HarnessRunStatus) === "failed") {
    throw new Error(runError ?? "Harness run failed")
  }
  return { assistantMessageId, replaceText, runId, status, text }
}
