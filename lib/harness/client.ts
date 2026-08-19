import type { HarnessEvent, HarnessRunStatus } from "./contracts"

export type HarnessStreamResult = {
  assistantMessageId?: string
  runId?: string
  status: HarnessRunStatus
  text: string
}

export async function consumeHarnessStream(
  response: Response,
  onEvent?: (event: HarnessEvent) => void | Promise<void>,
): Promise<HarnessStreamResult> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Harness request failed with HTTP ${response.status}`)
  }
  if (!response.body) throw new Error("The harness response has no event stream")

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let assistantMessageId: string | undefined
  let runId: string | undefined
  let status: HarnessRunStatus = "running"
  let text = ""
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
      if (!text && typeof event.payload.content === "string") text = event.payload.content
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
  return { assistantMessageId, runId, status, text }
}
