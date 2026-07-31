<p align="right"><a href="README_EN.md">English</a></p>

<div align="center">
  <img src="public/logo.png" alt="ModelHub" width="120" height="120" />

  <h1>ModelHub</h1>

  <p><strong>Gateway unificado para múltiplos provedores de IA com API compatível com OpenAI.</strong></p>

  <p>
    <a href="https://github.com/actus7/modelhub/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/actus7/modelhub/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="Licença MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
    <a href="https://nodejs.org"><img alt="Node.js >= 22" src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen" /></a>
    <a href="https://nextjs.org/"><img alt="Next.js 16.2" src="https://img.shields.io/badge/Next.js-16.2-black" /></a>
    <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5.x-blue" /></a>
    <a href="https://hono.dev/"><img alt="Hono 4" src="https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white" /></a>
    <a href="https://www.prisma.io/"><img alt="Prisma 7" src="https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white" /></a>
    <a href="https://neon.tech"><img alt="Powered by Neon" src="https://img.shields.io/badge/Powered%20by-Neon-00E599?logo=neon&logoColor=white" /></a>
    <a href="https://vercel.com/"><img alt="Deploy na Vercel" src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" /></a>
  </p>

  <p>
    <a href="#visao-geral">Visão geral</a> ·
    <a href="#funcionalidades">Funcionalidades</a> ·
    <a href="#quickstart">Quickstart</a> ·
    <a href="#api">API</a> ·
    <a href="#arquitetura">Arquitetura</a> ·
    <a href="#deploy">Deploy</a>
  </p>

  <p>
    <a href="https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub"><img alt="Deploy with Vercel" src="https://vercel.com/button" /></a>
  </p>
</div>

---

## Visão geral

ModelHub centraliza OpenAI, Google, Groq, Mistral, OpenRouter e outros provedores em uma única plataforma open-source. Ele entrega uma API compatível com OpenAI, chat web autenticado, gerenciamento seguro de credenciais e dashboard de uso.

Em vez de cada aplicação integrar vários provedores separadamente, o ModelHub padroniza autenticação, roteamento, logs, custos, catálogo de modelos e fallbacks.

## Funcionalidades

<table>
  <tr>
    <td><strong>API OpenAI-compatible</strong><br />Use <code>/v1/chat/completions</code> e <code>/v1/models</code> com clientes existentes.</td>
    <td><strong>Chat web</strong><br />Interface autenticada para conversar com modelos configurados.</td>
  </tr>
  <tr>
    <td><strong>Credenciais seguras</strong><br />API keys ModelHub e chaves de provedores criptografadas por usuário.</td>
    <td><strong>Dashboard de uso</strong><br />Requests, custos estimados, status codes, tokens e logs recentes.</td>
  </tr>
  <tr>
    <td><strong>Roteamento inteligente</strong><br />Tiers por complexidade, overrides por tarefa e fallbacks automáticos.</td>
    <td><strong>Anexos no chat</strong><br />Suporte a imagens, PDFs e documentos.</td>
  </tr>
  <tr>
    <td><strong>Catálogo dinâmico</strong><br />Modelos locais e busca remota quando o provider suporta.</td>
    <td><strong>Pronto para produção</strong><br />Rate limit, cooldown, headers de segurança, CI e deploy na Vercel.</td>
  </tr>
</table>

## Provedores

O catálogo fica em `server/lib/catalog.ts` e cada adapter vive em `server/providers/`.

| Suportados | |
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

Providers quebrados ou duplicados devem ser removidos do catálogo e do registry para não aparecerem na tela de integrações.

## Quickstart

### Requisitos

- Node.js >= 22
- pnpm >= 10
- PostgreSQL Neon
- Conta Neon Auth configurada
- `ENCRYPTION_KEY` de 64 caracteres hexadecimais
- Chaves dos provedores que você pretende usar

### Instalação local

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

| Rota | Descrição |
|---|---|
| `/chat` | Conversa com provedores configurados |
| `/setup` | Integrações e credenciais por provider |
| `/dashboard` | API keys, uso, custos, logs e routing |
| `/account` | Informações da conta |
| `/playground` | Comparação e teste de providers |

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

Modelos importantes: `User`, `ApiKey`, `ProviderCredential`, `Conversation`, `Message`, `ConversationAttachment`, `UsageLog`, `UserMemory` e `UserSettings`.

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

## Apoie o projeto

O ModelHub exige manutenção contínua, infraestrutura e testes com múltiplas APIs de IA. Seu patrocínio ajuda a cobrir esses custos e a manter o projeto aberto e atualizado.

[Patrocine o ModelHub pelo GitHub Sponsors](https://github.com/sponsors/actus7).

## Licença

MIT. Veja `LICENSE`.

## Agradecimentos

Next.js · Hono · Prisma · Neon · shadcn/ui · Vitest · Comunidade open-source
