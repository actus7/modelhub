# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ModelHub is a unified AI gateway that proxies requests to multiple AI providers (OpenAI, Google, Groq, Mistral, OpenRouter, DeepSeek, etc.) through a single OpenAI-compatible API. It includes a web chat interface, projects/canvas, an agent harness (tools + MCP), automatic routing, credential management, and a usage dashboard. The project is written in Portuguese (Brazilian).

## Common Commands

```bash
pnpm install          # Install dependencies (auto-runs prisma:generate via postinstall)
pnpm dev              # Start dev server at localhost:3000
pnpm build            # Production build
pnpm lint             # ESLint
pnpm format           # Prettier --write (pnpm format:check only verifies; CI runs it)
pnpm typecheck        # TypeScript type checking (tsc --noEmit)
pnpm test             # Run all tests with Vitest
pnpm test:coverage    # Tests with coverage thresholds (vitest.config.ts)
pnpm test -- path/to/file.test.ts  # Run a single test file
pnpm prisma:generate  # Regenerate Prisma client
pnpm prisma:migrate   # Run database migrations (dev)
pnpm prisma:push      # Push schema changes without migration (dev)
```

All Prisma commands require `--config prisma.config.ts` which the npm scripts already include.

## Architecture

### Dual-layer server: Next.js + Hono

The app runs as a **Next.js 16 App Router** application, but the API layer is a **Hono** app (`server/app.ts`) mounted via a Next.js route handler (`server/route-handler.ts`). The Hono app handles all `/v1/*` and provider-specific routes. Next.js handles pages, auth middleware, and the frontend.

### Server layout

- `server/app.ts` - root Hono app: request id, per-request log, `/health`, `/health/ready`, and mounting of the sub-apps.
- `server/routes/` - one Hono sub-app per resource (`user`, `conversations`, `projects`, `canvas`, `harness`, `v1`). Authenticated ones are created with `createAuthenticatedRouter` (`route-helpers.ts`), which wires security headers, CORS, auth and the shared error handler.
- `server/lib/` - infrastructure: `db`, `logger`, `http` (error responses), `security`, `health`, `routing/`, and the provider pipeline split by responsibility: `provider-core` (the per-provider Hono app), `provider-messages` (input schema, normalization, context), `provider-stream` (SSE conversions), `provider-upstream` (timeouts and upstream errors), `provider-usage-log`, `provider-config`.
- `server/harness/` - agent runtime (tools, MCP).

### Errors, logging and health

- Expected errors return `{ error: string, ...details }` via `jsonErrorResponse` (`server/lib/http.ts`). Unexpected errors are not caught per route: every Hono app uses `handleApiError` as `onError`, which logs and returns `{ error: { message }, requestId }` with status 500.
- Server code logs only through `logger` (`server/lib/logger.ts`): one JSON line per event, named `domain.event`, with fields as an object. `console.*` is an ESLint error under `server/`. `LOG_LEVEL` sets the minimum level (`silent` in tests). The request id is attached automatically (AsyncLocalStorage) and returned as `x-request-id`.
- `GET /health` is liveness (no dependencies). `GET /health/ready` pings the database and returns 503 when it is unreachable.
- External input (body, query, headers) is validated with a zod schema before use.

### Provider system

There is exactly one provider standard: an OpenAI-compatible API (`POST {baseUrl}/chat/completions`, `GET {baseUrl}/models`) authenticated with a Bearer API key. Providers are plain data entries in `server/providers/definitions.ts`; `server/providers/registry.ts` and `server/lib/catalog.ts` are derived from it via `createOpenAiCompatibleProvider` in `server/lib/openai-compatible.ts`. Do not add per-provider adaptations (body transforms, custom headers, model fallbacks, scraping, OAuth): a provider that does not fit the standard is not added. Models are cached via `server/lib/model-cache.ts`.

### Auth flow

Authentication uses **Neon Auth** (`@neondatabase/auth`). Auth logic is in `lib/auth/server.ts` (server) and `lib/auth/client.ts` (client). Middleware in `proxy.ts` protects authenticated routes (`/account/*`, `/chat`, `/dashboard/*`, `/playground`, `/projects/*`).

### Database

PostgreSQL via **Neon** (serverless), accessed through **Prisma 7** with the `@prisma/adapter-neon` adapter (`PrismaNeon` in `server/lib/db.ts`). Schema at `prisma/schema.prisma`, generated client output to `generated/prisma/`. Key models: User, ApiKey, ProviderCredential, Conversation, Message, ConversationAttachment, UsageLog, UserMemory, UserSettings.

### Frontend

- `app/(app)/` - authenticated pages (chat, dashboard, projects, playground)
- `components/` - React components organized by feature (chat/, dashboard/, canvas/, projects/, landing/, ui/)
- UI built with **shadcn/ui** (config in `components.json`), **Radix UI**, **Tailwind CSS v4**, **Recharts**
- Markdown rendering with react-markdown, rehype-highlight, remark-gfm, KaTeX math support
- Attachment processing: images, PDFs (pdfjs-dist), Office documents (jszip) in `server/lib/conversation-attachments.ts`

### Security

`server/lib/security.ts` handles CORS, access protection, rate limiting, and security headers. Provider credentials are encrypted via `server/lib/crypto.ts` using the `ENCRYPTION_KEY` env var. The `server/env.ts` module validates all environment variables at startup (strict in Vercel preview/production).

### Key path aliases

`@/*` maps to the project root (configured in tsconfig.json and vitest.config.ts).

## Environment Setup

Copy `.env.example` to `.env`. Required variables: `DATABASE_URL`, `DIRECT_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ENCRYPTION_KEY` (64 hex chars). Provider API keys are optional and enable shared-credential mode for that provider.

## Deploy

Vercel with the default `next build` (no `vercel.json`). Migrations are not run during the build; apply them with `pnpm prisma:migrate:deploy`.

## CI

GitHub Actions runs format:check, lint, typecheck, test, audit, and build in a single job on push/PR to main. Build step requires dummy env vars (see `.github/workflows/ci.yml`).

## Conventions

- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs(scope):`, etc.
- File naming: kebab-case for files, PascalCase for components, camelCase for functions
- 2-space indentation, double quotes, semicolons, 100 columns (Prettier, `.prettierrc`); run `pnpm format` before committing
- TypeScript is strict, including `noUncheckedIndexedAccess`, `noImplicitReturns` and `noUnusedLocals/Parameters`; no `any`
- Prefer Server Components; use `"use client"` only when needed
- Tests colocated with source files (e.g., `lib/chat-stream.test.ts`, `server/routes/user.test.ts`); there is no separate tests directory
- React hooks live in `hooks/`; code shared by client and server lives in `lib/`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
