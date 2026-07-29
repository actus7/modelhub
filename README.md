<p align="right"><a href="README_EN.md">English</a></p>

# ModelHub

<div align="center">

![ModelHub](https://img.shields.io/badge/ModelHub-AI%20Gateway-blue?style=for-the-badge)

**Gateway unificado para múltiplos provedores de IA com API compatível com OpenAI**

[![CI](https://github.com/actus7/modelhub/actions/workflows/ci.yml/badge.svg)](https://github.com/actus7/modelhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub)

[Sobre](#sobre) • [Funcionalidades](#funcionalidades) • [Setup](#setup-local) • [API](#api) • [Arquitetura](#arquitetura) • [CI/CD](#cicd)

</div>

---

## Sobre

ModelHub é uma plataforma open-source para centralizar o acesso a vários provedores de IA em uma única interface. Ele expõe uma API compatível com OpenAI, uma interface de chat, gerenciamento de credenciais por usuário e dashboard de uso.

A ideia é simples: em vez de cada aplicação integrar separadamente OpenAI, Google, Groq, Mistral, OpenRouter e outros, o ModelHub fica no meio e padroniza autenticação, roteamento, logs, custos e fallbacks.

## Funcionalidades

- **API Gateway OpenAI-compatible**: endpoints `/v1/chat/completions` e `/v1/models` para uso programático.
- **Chat web autenticado**: interface pronta para conversar com modelos configurados.
- **Gerenciamento de API keys**: crie chaves ModelHub para clientes, scripts e integrações.
- **Credenciais por provider**: salve chaves de provedores com criptografia no banco.
- **Dashboard de uso**: acompanhe requests, custos estimados, status codes, tokens e logs recentes.
- **Roteamento inteligente**: tiers por complexidade, overrides por tarefa e fallbacks quando modelos falham.
- **Suporte a anexos**: imagens, PDFs e documentos no fluxo de chat.
- **Catálogo dinâmico de modelos**: lista modelos locais e busca modelos remotos quando o provider suporta.
- **Rate limit e cooldown**: proteção básica contra abuso e provedores instáveis.
- **Deploy Vercel-ready**: build e preview integrados ao fluxo de PR.

## Provedores

O catálogo fica em `server/lib/catalog.ts` e cada adapter vive em `server/providers/`.

Provedores suportados incluem:

- OpenAI
- Google AI Studio
- Groq
- Mistral, incluindo Codestral como modelo Mistral
- OpenRouter
- HuggingFace
- DeepSeek
- Perplexity
- Together AI
- Fireworks AI
- Cohere
- Cloudflare Workers AI
- Ollama e Ollama Cloud
- GitHub Models
- GitHub Copilot
- Qwen e Qwen Token Plan
- Z.ai e Z.ai Coding Plan
- Moonshot/Kimi
- NVIDIA NIM
- Pollinations
- Puter

Providers quebrados ou duplicados devem ser removidos do catálogo e do registry para não aparecerem na tela de integrações.

## Requisitos

- Node.js >= 22
- pnpm >= 10
- PostgreSQL Neon
- Conta Neon Auth configurada
- `ENCRYPTION_KEY` de 64 caracteres hexadecimais
- Chaves dos provedores que você pretende usar

## Setup local

```bash
git clone https://github.com/actus7/modelhub.git
cd modelhub
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
```

Acesse `http://localhost:3000`.

`pnpm install` executa `pnpm prisma:generate` automaticamente via `postinstall`.

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

Opcionais comuns:

```env
OPENAI_API_KEY="sk-..."
GOOGLE_AI_STUDIO_API_KEY="AIza..."
OPENROUTER_API_KEY="sk-or-..."
GROQ_API_KEY="gsk_..."
MISTRAL_API_KEY="sk-..."
DEEPSEEK_API_KEY="sk-..."
```

Sem chave global, o usuário ainda pode cadastrar credenciais próprias pela tela **Integrações** quando o provider exigir autenticação.

## Comandos

```bash
pnpm dev              # servidor local em localhost:3000
pnpm build            # build de produção
pnpm build:vercel     # build usado na Vercel
pnpm start            # executa build gerado
pnpm lint             # ESLint
pnpm typecheck        # TypeScript sem emit
pnpm test             # Vitest
pnpm test:coverage    # Vitest com coverage
pnpm prisma:generate  # gera Prisma Client
pnpm prisma:migrate   # migração local com Prisma
pnpm prisma:push      # push de schema em desenvolvimento
```

## API

### Chat completions

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Olá!"}
    ]
  }'
```

### Streaming

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB" \
  -d '{
    "model": "mistral/codestral-latest",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Explique uma função debounce em TypeScript."}
    ]
  }'
```

### Listar modelos

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB"
```

O campo `model` segue o formato `provider/model`, por exemplo:

- `openai/gpt-4o-mini`
- `googleaistudio/gemini-2.5-flash`
- `mistral/codestral-latest`
- `openrouter/openai/gpt-oss-20b:free`

## Interface web

- `/chat`: conversa com provedores configurados.
- `/setup`: tela de integrações e credenciais por provider.
- `/dashboard`: API keys, uso, custos, logs e routing.
- `/account`: informações da conta.
- `/playground`: comparação/teste de providers.

Rotas autenticadas são protegidas por `proxy.ts`.

## Arquitetura

```text
app/                         Next.js App Router
app/(app)/                   rotas autenticadas
components/                  componentes React
components/chat/             UI do chat
components/dashboard/        dashboard, API keys, routing e analytics
components/setup/            tela de integrações
components/ui/               shadcn/ui e componentes base
lib/                         helpers compartilhados
lib/auth/                    Neon Auth client/server
server/app.ts                app Hono principal
server/route-handler.ts      ponte entre Next.js e Hono
server/routes/               rotas /user, /v1, conversations etc.
server/providers/            adapters dos provedores
server/lib/openai-compatible.ts utilitário para providers OpenAI-compatible
server/lib/routing/          roteamento, tiers, health e sugestões
server/lib/security.ts       CORS, rate limit e headers
server/lib/db.ts             Prisma + Neon adapter
prisma/schema.prisma         schema do banco
prisma/migrations/           migrações
```

A aplicação usa duas camadas:

1. **Next.js 16 App Router** para páginas, layouts, autenticação do frontend e integração com Vercel.
2. **Hono** para a API de gateway, providers, usuário e rotas compatíveis com OpenAI.

## Banco de dados

O banco é PostgreSQL via Neon, acessado com Prisma 7 e `@prisma/adapter-neon`.

Modelos importantes:

- `User`
- `ApiKey`
- `ProviderCredential`
- `Conversation`
- `Message`
- `ConversationAttachment`
- `UsageLog`
- `UserMemory`
- `UserSettings`

Para mudanças de schema:

```bash
pnpm prisma:migrate
pnpm prisma:generate
```

## Segurança

- API keys ModelHub são armazenadas por hash/prefixo.
- Credenciais de providers são criptografadas com `ENCRYPTION_KEY`.
- Logs de erro passam por scrub para evitar vazamento de segredos.
- Rate limit e cooldown reduzem abuso e loops de falha.
- Nunca commite `.env`, tokens ou chaves reais.

Para reportar vulnerabilidades, veja `SECURITY.md`.

## CI/CD

GitHub Actions roda em PRs e pushes para `main`/`develop`:

- Lint (`pnpm lint`)
- Type check (`pnpm typecheck`)
- Testes (`pnpm test`)
- Security audit de dependências de produção (`pnpm audit --prod --audit-level=high`)
- Build (`pnpm build`)
- CodeQL
- Dependency Review opcional via variável `ENABLE_DEPENDENCY_REVIEW=true`

A Vercel gera previews automaticamente para PRs.

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub)

1. Conecte o repositório na Vercel.
2. Configure as variáveis de ambiente obrigatórias.
3. Garanta que o build use `pnpm build` ou `pnpm build:vercel`, conforme o projeto Vercel.
4. Rode migrações no banco antes de promover produção quando houver mudança em `prisma/migrations/`.

### Docker

Se usar Docker, passe `.env` no runtime:

```bash
docker build -t modelhub .
docker run --env-file .env -p 3000:3000 modelhub
```

## Contribuição

Veja `CONTRIBUTING.md`.

Fluxo recomendado:

```bash
git checkout -b fix/minha-mudanca
pnpm test
pnpm lint
pnpm typecheck
```

Use Conventional Commits:

```text
feat(chat): adiciona suporte a novo anexo
fix(providers): remove integração quebrada
docs(readme): atualiza instruções de setup
```

## Licença

MIT. Veja `LICENSE`.

## Agradecimentos

- Next.js
- Hono
- Prisma
- Neon
- shadcn/ui
- Vitest
- Comunidade open-source
