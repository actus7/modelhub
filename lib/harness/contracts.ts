export const HARNESS_ENGINE_VERSION = "harness-v1" as const

export type HarnessRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "yielded"
  | "completed"
  | "failed"
  | "cancelled"

export type HarnessEventType =
  | "turn/start"
  | "turn/end"
  | "step/start"
  | "step/end"
  | "user/message"
  | "assistant/chunk"
  | "assistant/message"
  | "tool/call"
  | "tool/result"
  | "tool/approval-required"
  | "run/status"
  | "run/yielded"
  | "run/error"
  | "goal/change"
  | "plan/change"
  | "todo/change"
  | "compaction/summary"
  | "subagent/start"
  | "subagent/end"

export type HarnessEvent<TPayload = Record<string, unknown>> = {
  conversationId: string
  createdAt: string
  eventId: string
  payload: TPayload
  runId: string | null
  seq: string
  stepId: string | null
  turnId: string | null
  type: HarnessEventType | (string & {})
}

export type HarnessToolRisk = "read" | "reversible-write" | "external-write" | "destructive"
export type HarnessToolExecutionMode = "sequential" | "parallel-safe"

export type JsonSchema = {
  additionalProperties?: boolean
  description?: string
  enum?: unknown[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  type?: "array" | "boolean" | "integer" | "number" | "object" | "string"
}

export type HarnessToolSchema = {
  description: string
  inputSchema: JsonSchema
  name: string
}

export type HarnessToolCall = {
  args: Record<string, unknown>
  toolCallId: string
  toolName: string
}

export type HarnessApprovalSummary = {
  id: string
  reason: string
  risk: HarnessToolRisk
  status: "pending" | "executing" | "approved" | "denied" | "failed" | "cancelled" | "unknown"
  toolCallId: string
  toolName: string
}

export type HarnessTurnRequest = {
  enteredMessages?: HarnessTurnRequest["messages"]
  idempotencyKey: string
  maxSteps?: number
  messages: Array<{
    content?: unknown
    parts?: unknown
    role: "assistant" | "system" | "tool" | "user"
    tool_call_id?: string
    tool_calls?: unknown
  }>
  model: string
  projectId?: string
}

export type HarnessRunSummary = {
  conversationId: string
  error: string | null
  id: string
  modelId: string | null
  providerId: string | null
  status: HarnessRunStatus
  stepCount: number
}

export type HarnessCapability = {
  available: boolean
  description: string
  id: string
  reason?: string
}

export type HarnessPluginManifest = {
  capabilities: string[]
  description: string
  id: string
  version: string
}
