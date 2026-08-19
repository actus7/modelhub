<p align="right"><a href="README.md">Português</a></p>

<div align="center">
  <img src="public/logo.png" alt="ModelHub" width="120" height="120" />

  <h1>ModelHub</h1>

  <p><strong>Unified gateway for multiple AI providers with an OpenAI-compatible API.</strong></p>

  <p>
    <a href="https://github.com/actus7/modelhub/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/actus7/modelhub/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
    <a href="https://nodejs.org"><img alt="Node.js >= 22" src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen" /></a>
    <a href="https://nextjs.org/"><img alt="Next.js 16.3" src="https://img.shields.io/badge/Next.js-16.3-black" /></a>
    <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5.x-blue" /></a>
    <a href="https://hono.dev/"><img alt="Hono 4" src="https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white" /></a>
    <a href="https://www.prisma.io/"><img alt="Prisma 7" src="https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white" /></a>
    <a href="https://neon.tech"><img alt="Powered by Neon" src="https://img.shields.io/badge/Powered%20by-Neon-00E599?logo=neon&logoColor=white" /></a>
    <a href="https://vercel.com/"><img alt="Deploy on Vercel" src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" /></a>
  </p>

  <p>
    <a href="#overview">Overview</a> ·
    <a href="#features">Features</a> ·
    <a href="#quickstart">Quickstart</a> ·
    <a href="#api">API</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#deploy">Deploy</a>
  </p>

  <p>
    <a href="https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub"><img alt="Deploy with Vercel" src="https://vercel.com/button" /></a>
  </p>
</div>

---

## Overview

ModelHub centralizes OpenAI, Google, Groq, Mistral, OpenRouter and other providers into a single open-source platform. It delivers an OpenAI-compatible API, authenticated web chat, secure credential management, and a usage dashboard.

Instead of each application integrating multiple providers separately, ModelHub standardizes authentication, routing, logs, costs, model catalog, and fallbacks.

## Features

<table>
  <tr>
    <td><strong>OpenAI-compatible API</strong><br />Use <code>/v1/chat/completions</code> and <code>/v1/models</code> with existing clients.</td>
    <td><strong>Web chat</strong><br />Authenticated interface to chat with configured models.</td>
  </tr>
  <tr>
    <td><strong>Secure credentials</strong><br />ModelHub API keys and provider keys encrypted per user.</td>
    <td><strong>Usage dashboard</strong><br />Requests, estimated costs, status codes, tokens, and recent logs.</td>
  </tr>
  <tr>
    <td><strong>Smart routing</strong><br />Tiers by complexity, per-task overrides, and automatic fallbacks.</td>
    <td><strong>Chat attachments</strong><br />Support for images, PDFs, and documents.</td>
  </tr>
  <tr>
    <td><strong>Versioned canvas</strong><br />Edit, preview, restore, and share Markdown, code, HTML, React, and Mermaid content.</td>
    <td><strong>Projects</strong><br />Group conversations, instructions, knowledge files, and reusable artifacts.</td>
  </tr>
  <tr>
    <td><strong>Dynamic catalog</strong><br />Local models and remote search when the provider supports it.</td>
    <td><strong>Production-ready</strong><br />Rate limiting, cooldown, security headers, CI, and Vercel deploy.</td>
  </tr>
</table>

## Providers

The catalog lives in `server/lib/catalog.ts` and each adapter lives in `server/providers/`.

| Supported | |
|---|---|
| OpenAI | Google AI Studio |
| Groq | Mistral / Codestral |
| OpenRouter | HuggingFace |
| DeepSeek | Perplexity |
| Together AI | Fireworks AI |
| Cohere | Cloudflare Workers AI |
| Ollama / Ollama Cloud | GitHub Models |
| GitHub Copilot | Qwen / Qwen Token Plan |
| Z.ai / Z.ai Coding Plan | Moonshot / Kimi |
| NVIDIA NIM | Pollinations / Puter |

Broken or duplicate providers should be removed from both the catalog and the registry so they don't appear on the integrations screen.

## Quickstart

### Requirements

- Node.js >= 22
- pnpm >= 10
- PostgreSQL Neon
- Configured Neon Auth account
- `ENCRYPTION_KEY` with 64 hex characters
- Keys for the providers you intend to use

### Local installation

```bash
git clone https://github.com/actus7/modelhub.git
cd modelhub
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
```

Visit `http://localhost:3000`.

`pnpm install` automatically runs `pnpm prisma:generate` via `postinstall`.

## Environment variables

See `.env.example` for the full list.

Required:

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEON_AUTH_BASE_URL="https://..."
NEON_AUTH_COOKIE_SECRET="..."
ENCRYPTION_KEY="64_hex_chars"
```

Common optional:

```env
OPENAI_API_KEY="sk-..."
GOOGLE_AI_STUDIO_API_KEY="AIza..."
OPENROUTER_API_KEY="sk-or-..."
GROQ_API_KEY="gsk_..."
MISTRAL_API_KEY="sk-..."
DEEPSEEK_API_KEY="sk-..."
```

Without a global key, users can still register their own credentials on the **Integrations** screen when the provider requires authentication.

## Commands

```bash
pnpm dev              # local server at localhost:3000
pnpm build            # production build
pnpm build:vercel     # build used on Vercel
pnpm start            # runs the generated build
pnpm lint             # ESLint
pnpm typecheck        # TypeScript without emit
pnpm test             # Vitest
pnpm test:coverage    # Vitest with coverage
pnpm prisma:generate  # generates Prisma Client
pnpm prisma:migrate   # local Prisma migration
pnpm prisma:push      # push schema in development
```

## API

### Chat completions

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MODELHUB_API_KEY" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Streaming

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MODELHUB_API_KEY" \
  -d '{
    "model": "mistral/codestral-latest",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Explain a debounce function in TypeScript."}
    ]
  }'
```

### List models

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_MODELHUB_API_KEY"
```

The `model` field follows the `provider/model` format, for example:

- `openai/gpt-4o-mini`
- `googleaistudio/gemini-2.5-flash`
- `mistral/codestral-latest`
- `openrouter/openai/gpt-oss-20b:free`

## Web interface

| Route | Description |
|---|---|
| `/chat` | Chat with configured providers |
| `/projects` | Projects, knowledge files, and canvas artifacts |
| `/setup` | Integrations and credentials per provider |
| `/dashboard` | API keys, usage, costs, logs, and routing |
| `/account` | Account information |
| `/playground` | Compare and test providers |

Authenticated routes are protected by `proxy.ts`.

## Architecture

```text
app/                         Next.js App Router
app/(app)/                   authenticated routes
components/                  React components
components/chat/             chat UI
components/dashboard/        dashboard, API keys, routing, and analytics
components/setup/            integrations screen
components/ui/               shadcn/ui and base components
lib/                         shared helpers
lib/auth/                    Neon Auth client/server
server/app.ts                main Hono app
server/route-handler.ts      bridge between Next.js and Hono
server/routes/               /user, /v1, conversations, etc. routes
server/providers/            provider adapters
server/lib/openai-compatible.ts utility for OpenAI-compatible providers
server/lib/routing/          routing, tiers, health, and suggestions
server/lib/security.ts       CORS, rate limit, and headers
server/lib/db.ts             Prisma + Neon adapter
prisma/schema.prisma         database schema
prisma/migrations/           migrations
```

The application uses two layers:

1. **Next.js 16 App Router** for pages, layouts, frontend authentication, and Vercel integration.
2. **Hono** for the gateway API, providers, user, and OpenAI-compatible routes.

## Database

The database is PostgreSQL via Neon, accessed with Prisma 7 and `@prisma/adapter-neon`.

Key models: `User`, `ApiKey`, `ProviderCredential`, `Conversation`, `Message`, `ConversationAttachment`, `Project`, `ProjectFile`, `ProjectArtifact`, `Canvas`, `UsageLog`, `UserMemory`, and `UserSettings`.

For schema changes:

```bash
pnpm prisma:migrate
pnpm prisma:generate
```

## Security

- ModelHub API keys are stored by hash/prefix.
- Provider credentials are encrypted with `ENCRYPTION_KEY`.
- Error logs are scrubbed to prevent secret leakage.
- Rate limiting and cooldown reduce abuse and failure loops.
- Never commit `.env`, tokens, or real keys.

To report vulnerabilities, see `SECURITY.md`.

## CI/CD

GitHub Actions runs on PRs and pushes to `main`/`develop`:

- Lint (`pnpm lint`)
- Type check (`pnpm typecheck`)
- Tests (`pnpm test`)
- Production dependency security audit (`pnpm audit --prod --audit-level=high`)
- Build (`pnpm build`)
- CodeQL
- Optional Dependency Review via the `ENABLE_DEPENDENCY_REVIEW=true` variable

Vercel automatically generates previews for PRs.

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub)

1. Connect the repository on Vercel.
2. Configure the required environment variables.
3. Ensure the build uses `pnpm build` or `pnpm build:vercel`, depending on the Vercel project.
4. Run database migrations before promoting to production when there are changes in `prisma/migrations/`.

### Docker

If using Docker, pass `.env` at runtime:

```bash
docker build -t modelhub .
docker run --env-file .env -p 3000:3000 modelhub
```

## Contributing

See `CONTRIBUTING.md`.

```bash
git checkout -b fix/my-change
pnpm test
pnpm lint
pnpm typecheck
```

Use Conventional Commits:

```text
feat(chat): add support for new attachment
fix(providers): remove broken integration
docs(readme): update setup instructions
```

## Xiaomi MiMo Spark — candidate demo

<div align="center">
  <a href="https://www.mi.com">
    <img src="https://upload.wikimedia.org/wikipedia/commons/a/ae/Xiaomi_logo_%282021-%29.svg" alt="Xiaomi" width="120" />
  </a>

  <h3>ModelHub × Xiaomi MiMo</h3>

  <p>
    ModelHub is submitting a real technical demo for evaluation in the <strong>MiMo Spark Program</strong>. Core-user status has not been confirmed. The program may offer an opportunity to try new models early, but early access is not guaranteed.
  </p>

  <p>
    <a href="docs/case-studies/xiaomi-mimo.md"><img alt="MiMo case study" src="https://img.shields.io/badge/Case_study-MiMo-FF6900?logo=xiaomi&logoColor=white" /></a>
    <a href="https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call"><img alt="MiMo API documentation" src="https://img.shields.io/badge/API-OpenAI_compatible-111111" /></a>
  </p>
</div>

---

## Support the project

ModelHub requires continuous maintenance, infrastructure, and testing with multiple AI APIs. Your sponsorship helps cover these costs and keeps the project open and up to date.

[Sponsor ModelHub on GitHub Sponsors](https://github.com/sponsors/actus7).

## License

MIT. See `LICENSE`.

## Acknowledgements

Xiaomi MiMo · Next.js · Hono · Prisma · Neon · shadcn/ui · Vitest · Open-source community
