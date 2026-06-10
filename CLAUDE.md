# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ModelHub is a unified AI gateway that proxies requests to multiple AI providers (OpenAI, Anthropic, Google, Groq, Mistral, Cohere, HuggingFace, OpenRouter, etc.) through a single OpenAI-compatible API. It includes a web chat interface, credential management, and usage dashboard. The project is written in Portuguese (Brazilian).

## Common Commands

```bash
pnpm install          # Install dependencies (auto-runs prisma:generate via postinstall)
pnpm dev              # Start dev server at localhost:3000
pnpm build            # Production build
pnpm lint             # ESLint
pnpm typecheck        # TypeScript type checking (tsc --noEmit)
pnpm test             # Run all tests with Vitest
pnpm test -- path/to/file.test.ts  # Run a single test file
pnpm prisma:generate  # Regenerate Prisma client
pnpm prisma:migrate   # Run database migrations (dev)
pnpm prisma:push      # Push schema changes without migration (dev)
```

All Prisma commands require `--config prisma.config.ts` which the npm scripts already include.

## Architecture

### Dual-layer server: Next.js + Hono

The app runs as a **Next.js 16 App Router** application, but the API layer is a **Hono** app (`server/app.ts`) mounted via a Next.js route handler (`server/route-handler.ts`). The Hono app handles all `/v1/*`, provider-specific, and proxy routes. Next.js handles pages, auth middleware, and the frontend.

### Provider system

Each AI provider lives in `server/providers/<name>.ts` and exports a fetch handler + static model list (+ optional dynamic `fetchModels`). All providers are registered in `server/providers/registry.ts` as a `providerRegistry` record. Many providers use `server/lib/openai-compatible.ts` for OpenAI-compatible API translation. Models are cached via `server/lib/model-cache.ts`.

### Auth flow

Authentication uses **Neon Auth** (`@neondatabase/auth`). Auth logic is in `lib/auth/server.ts` (server) and `lib/auth/client.ts` (client). Middleware in `proxy.ts` protects authenticated routes (`/account/*`, `/chat`, `/dashboard`, `/setup`).

### Database

PostgreSQL via **Neon** (serverless), accessed through **Prisma 7** with the `@prisma/adapter-neon` adapter (`PrismaNeonHttp` in `server/lib/db.ts`). Schema at `prisma/schema.prisma`, generated client output to `generated/prisma/`. Key models: User, ApiKey, ProviderCredential, Conversation, Message, ConversationAttachment, UsageLog, UserMemory, UserSettings.

### Frontend

- `app/(app)/` - authenticated pages (chat, dashboard, setup)
- `components/` - React components organized by feature (chat/, dashboard/, landing/, setup/, ui/)
- UI built with **shadcn/ui** (config in `components.json`), **Radix UI**, **Tailwind CSS v4**, **Recharts**
- Markdown rendering with react-markdown, rehype-highlight, remark-gfm, KaTeX math support
- Attachment processing: images, PDFs (pdfjs-dist), documents (jsdom) in `lib/chat-attachments.ts`

### Security

`server/lib/security.ts` handles CORS, access protection, rate limiting, and security headers. Provider credentials are encrypted via `server/lib/crypto.ts` using the `ENCRYPTION_KEY` env var. The `server/env.ts` module validates all environment variables at startup (strict in Vercel preview/production).

### Key path aliases

`@/*` maps to the project root (configured in tsconfig.json and vitest.config.ts).

## Environment Setup

Copy `.env.example` to `.env`. Required variables: `DATABASE_URL`, `DIRECT_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ENCRYPTION_KEY` (64 hex chars). Provider API keys are optional and enable shared-credential mode for that provider.

## CI

GitHub Actions runs lint, typecheck, test, and build in parallel on push/PR to main and develop branches. Build step requires dummy env vars (see `.github/workflows/ci.yml`).

## Conventions

- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs(scope):`, etc.
- File naming: kebab-case for files, PascalCase for components, camelCase for functions
- 2-space indentation, single quotes, semicolons (Prettier configured in `.prettierrc`)
- Prefer Server Components; use `"use client"` only when needed
- Tests colocated with source files (e.g., `lib/chat-stream.test.ts`)
