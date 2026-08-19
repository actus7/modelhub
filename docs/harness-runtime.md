# ModelHub Harness Runtime

The chat runtime is an event-sourced agent harness built into the existing Next.js/Hono application. It keeps the established provider gateway, Neon database, conversation UI, projects, attachments, Canvas, routing and browser-only providers intact.

## Runtime selection

- Models that advertise `capabilities.tools` use the harness.
- ModelHub Auto uses the harness and keeps the existing routing/fallback layer.
- Models without tool support, temporary chats and browser-session providers keep the direct chat path.

This is a capability fallback, not a second permanent engine switch. Durable conversations identify the current engine with `Conversation.engineVersion`.

## Execution model

Each durable turn creates an idempotent `AgentRun` and appends ordered `SessionEvent` rows. A partial unique index admits only one active root run per conversation. Leases are versioned and fenced on every state commit, and a run can end as `completed`, `waiting_approval`, `yielded`, `failed` or `cancelled`.

Vercel executions yield before the function deadline. While the client remains connected, the UI calls the continuation endpoint until the run completes or needs approval. Reopening a conversation reads its normal `Message` projection; the event log remains the canonical execution trace.

## Capabilities

| Capability | Status | Implementation |
| --- | --- | --- |
| Agent loop and tool calls | Available | OpenAI-compatible tool schemas through the existing provider gateway |
| Tool execution pipeline | Available | Reversible plugin middleware around guard/pre/execute/post/error phases |
| Durable event log | Available | `SessionEvent` with monotonic `BIGSERIAL` sequence |
| Goals, plans and todos | Available | Typed change events and built-in tools |
| Project workspace | Available | Neon-backed virtual files with immutable versions |
| Memory and session search | Available | Scoped database queries |
| Web fetch/search | Available | Public HTTP only, connect-time DNS pinning, redirect revalidation and response bounds |
| Remote MCP | Available | HTTPS Streamable HTTP/SSE JSON-RPC, paginated discovery, encrypted headers and tool cache |
| Skills | Available | User/project-scoped prompt modules with versioning |
| Subagents | Available | Bounded child runs with parent/depth tracking |
| Forks | Available | Conversation/event/message/attachment copy at an event boundary |
| Shell, PTY, local MCP stdio, native LSP | Unavailable | Explicitly reported as unavailable on the serverless runtime |

## Approval policy

Only read-only operations run automatically. Reversible writes, delegated model calls, every remote MCP call and destructive actions pause the run in `waiting_approval`; remote annotations can increase but never lower risk. Approval claims are one-shot, cancelled runs invalidate open claims, expired executions become `unknown` rather than being repeated, and operation keys are propagated to remote adapters.

## HTTP API

All endpoints require the same ModelHub authentication as the existing API.

- `POST /harness/conversations/:id/turns`
- `GET /harness/conversations/:id/events?after=<seq>`
- `POST /harness/conversations/:id/fork`
- `PATCH /harness/conversations/:id/messages/:messageId/projection`
- `GET /harness/agent-runs/:id`
- `POST /harness/agent-runs/:id/continue`
- `POST /harness/agent-runs/:id/cancel`
- `GET /harness/agent-runs/:id/approvals`
- `POST /harness/tool-approvals/:id/resolve`
- `GET /harness/capabilities`
- `GET /harness/plugins`
- `PATCH /harness/plugins/:pluginId`
- `GET|POST|PATCH|DELETE /harness/mcp-servers[/:id]`
- `GET|POST|PATCH|DELETE /harness/skills[/:id]`

Turn and continuation responses use Server-Sent Events. Every `harness` event contains `eventId`, decimal-string `seq`, `conversationId`, optional run/turn/step IDs, type, timestamp and JSON payload. Live text chunks use `seq: "0"`; raw deltas are also persisted in ordered batches of at most 32 before the final message projection.

## Migration and rollback

`20260819120000_harness_runtime` is additive. It creates the runtime tables, seeds version 1 for existing project files and backfills existing messages into the event log. Existing message and conversation APIs remain readable during rollback.

Before deploying application code, check for duplicate `(projectId, fileName)` rows, then run the normal Prisma deployment command against the target database. The migration adds atomic uniqueness for project paths and active root runs. Roll back the application independently if necessary; do not drop the additive tables until the previous version is stable and their data is no longer needed.

## Security limits

- MCP requires HTTPS. MCP and web URLs reject credentials, localhost and private/reserved targets, and connections are pinned to the validated address to close DNS-rebinding races.
- Remote responses are capped at 1 MB and use explicit timeouts.
- MCP request headers are encrypted with the existing `ENCRYPTION_KEY` mechanism and are never returned by the API.
- Turn bodies are capped at 4 MiB; tool results/events at 1 MiB. A step admits at most 16 tool calls and a run at most four direct child agents, in addition to step/depth limits.
- Tool results are recorded even on failure, so the model cannot treat an unexecuted operation as successful.
