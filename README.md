<p align="right"><a href="README_EN.md">English</a></p>

# ModelHub

Gateway unificado de IA com API compatível com OpenAI, chat web, gerenciamento de credenciais e dashboard de uso.

[![CI](https://github.com/actus7/modelhub/actions/workflows/ci.yml/badge.svg)](https://github.com/actus7/modelhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)

## Sobre

ModelHub centraliza chamadas para múltiplos provedores de IA em uma única API OpenAI-compatible. A aplicação combina:

- Chat web autenticado
- Proxy `/v1/*` compatível com OpenAI
- Cadastro de API keys para uso programático
- Credenciais de provedores criptografadas por usuário
- Dashboard com uso, custos, status e logs recentes
- Roteamento por complexidade/tarefa com fallbacks
- Upload de anexos no chat

## Provedores

O catálogo é carregado em `server/lib/catalog.ts` e os handlers ficam em `server/providers/`.

Provedores suportados incluem OpenAI, Google AI Studio, Groq, Mistral, OpenRouter, HuggingFace, DeepSeek, Perplexity, Together AI, Fireworks, Cohere, Cloudflare Workers AI, Ollama, GitHub Models, Copilot, Qwen, Z.ai, Moonshot, NVIDIA NIM, Pollinations e outros.

## Requisitos

- Node.js >= 22
- pnpm >= 10
- PostgreSQL Neon
- Variáveis de ambiente configuradas

## Setup local

```bash
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
```

Acesse `http://localhost:3000`.

## Variáveis de ambiente

Veja `.env.example` para a lista completa.

Obrigatórias:

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEON_AUTH_BASE_URL="https://..."
NEON_AUTH_COOKIE_SECRET="..."
ENCRYPTION_KEY="64_hex_chars"
```

Chaves de provedores são opcionais. Sem chave global, o usuário pode cadastrar credenciais pela tela de integrações quando o provider exigir API key.

## Comandos

```bash
pnpm dev              # servidor local
pnpm build            # build de produção
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
pnpm test             # Vitest
pnpm test:coverage    # cobertura
pnpm prisma:generate  # Prisma Client
pnpm prisma:migrate   # migrações locais
pnpm prisma:push      # push de schema em dev
```

## API

### Chat completions

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Olá"}]
  }'
```

### Modelos

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB"
```

## Arquitetura

```text
app/                  Next.js App Router
components/           UI React e shadcn/ui
lib/                  helpers compartilhados do frontend/server
server/app.ts         app Hono principal
server/route-handler.ts montagem Hono em rota Next.js
server/providers/     adapters dos provedores
server/lib/           routing, cache, segurança, pricing e banco
prisma/               schema e migrações
```

O frontend é Next.js 16 App Router. A API é um app Hono montado pelo Next.js e atende `/v1/*`, rotas de usuário, provedores e proxies.

## CI/CD

GitHub Actions executa em PRs e pushes para `main`/`develop`:

- Lint
- Type check
- Testes
- Security audit de dependências de produção (`pnpm audit --prod --audit-level=high`)
- Build
- CodeQL
- Dependency Review opcional via `ENABLE_DEPENDENCY_REVIEW=true`

Deploy de preview/produção é feito pela integração da Vercel.

## Contribuição

Veja `CONTRIBUTING.md`.

Fluxo recomendado:

```bash
git checkout -b fix/minha-mudanca
pnpm test
pnpm lint
pnpm typecheck
```

Use Conventional Commits, por exemplo `fix(providers): remove integracao quebrada`.

## Segurança

Credenciais de provedores são criptografadas com `ENCRYPTION_KEY`. Nunca commite `.env`, tokens ou chaves reais.

Para vulnerabilidades, veja `SECURITY.md`.

## Licença

MIT. Veja `LICENSE`.
