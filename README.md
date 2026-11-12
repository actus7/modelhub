<div align="center">
  <img src="public/logo.png" alt="ModelHub" width="120" height="120" />

  <h1>ModelHub</h1>

  <p><strong>Gateway unificado para provedores de IA compatíveis com OpenAI.</strong></p>

  <p>
    <a href="https://github.com/actus7/modelhub/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/actus7/modelhub/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="Licença MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
    <a href="https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub"><img alt="Deploy with Vercel" src="https://vercel.com/button" /></a>
  </p>
</div>

---

ModelHub expõe uma única API compatível com OpenAI (`/v1/chat/completions`, `/v1/models`) na frente de vários provedores, com chat web, projetos/canvas, agentes com ferramentas (harness + MCP), roteamento automático por complexidade, credenciais criptografadas por usuário e dashboard de uso.

## Provedores

Todo provedor segue um único padrão: API OpenAI-compatível (`POST /chat/completions`, `GET /models`) autenticada por API key Bearer. Eles são declarados em uma tabela só, `server/providers/definitions.ts`, e adicionar um novo é acrescentar uma entrada ali.

OpenAI · Google AI Studio · Vercel AI Gateway · OpenRouter · Groq · Cerebras · Mistral · DeepSeek · Together AI · Fireworks AI · NVIDIA NIM · HuggingFace · GitHub Models · Perplexity · Moonshot (Kimi) · Qwen · Qwen Token Plan · Z.ai · Z.ai Coding Plan · Xiaomi MiMo Token Plan · BytePlus ModelArk Coding Plan · Command Code · OpenCode Zen · OpenCode Go · OpenGateway · Ollama Cloud

## Quickstart

Requisitos: Node.js 22+, pnpm 10+, um banco Neon com Neon Auth.

```bash
pnpm install          # também roda prisma generate
cp .env.example .env  # preencha as variáveis obrigatórias
pnpm prisma:migrate
pnpm dev              # http://localhost:3000
```

Variáveis obrigatórias: `DATABASE_URL`, `DIRECT_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` e `ENCRYPTION_KEY` (64 caracteres hex). Chaves de provedor (`OPENAI_API_KEY`, `GROQ_API_KEY`...) são opcionais: definidas no ambiente, valem para todos os usuários; sem elas, cada usuário conecta a própria chave em `/dashboard/credentials`.

## API

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer SUA_API_KEY_MODELHUB" \
  -H "Content-Type: application/json" \
  -d '{"model": "groq/llama-3.3-70b-versatile", "stream": true,
       "messages": [{"role": "user", "content": "Olá!"}]}'
```

`model` segue o formato `provider/modelo`. `GET /v1/models` lista o que está disponível.

## Comandos

```bash
pnpm dev | build | start
pnpm lint | typecheck | test | test:coverage
pnpm format | format:check                 # Prettier
pnpm prisma:generate | prisma:migrate | prisma:migrate:deploy
```

O CI roda `format:check`, `lint`, `typecheck`, `test`, `audit` e `build`; rode os quatro primeiros antes de abrir um PR.

## Arquitetura

- **Next.js 16 (App Router)**: páginas, auth (Neon Auth, `proxy.ts`) e frontend (shadcn/ui, Tailwind 4).
- **Hono** (`server/app.ts`), montado via route handler: `/v1/*`, rotas por provedor e APIs do usuário.
- **Prisma 7 + Neon** (`server/lib/db.ts`, `prisma/schema.prisma`).
- `server/lib/openai-compatible.ts`: o único cliente de provedor. `server/lib/routing/`: roteamento automático.

```
app/          páginas e route handlers do Next (delegam a API para o Hono)
components/   componentes React por feature (chat, dashboard, canvas, projects, ui)
hooks/        hooks React compartilhados
lib/          código compartilhado entre cliente e servidor (contratos, parsing de stream)
server/
  app.ts      app Hono raiz: request id, log por requisição, health, montagem das rotas
  routes/     uma sub-app por recurso (user, conversations, projects, canvas, harness, v1)
  lib/        infraestrutura: db, logger, http (erros), security, provider-*, routing/
  harness/    runtime de agentes (ferramentas, MCP)
  providers/  tabela de provedores e registro derivado
prisma/       schema e migrations
```

Testes ficam ao lado do código que cobrem (`foo.ts` + `foo.test.ts`).

## Operação

- **Health checks**: `GET /health` (liveness, não toca em dependências) e `GET /health/ready` (readiness, responde 503 se o banco não responder).
- **Logs**: o servidor emite uma linha JSON por evento (`server/lib/logger.ts`), com `level`, `event`, `time` e `requestId`. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`; padrão `info`) define o nível mínimo. Segredos em mensagens de erro são redigidos.
- **Request ID**: toda resposta da API traz `x-request-id` (o enviado pelo cliente, se bem formado, ou um gerado). Ele aparece em todos os logs da requisição e no corpo dos erros 500.
- **Erros**: erros esperados respondem `{ "error": "mensagem" }`; falhas não tratadas respondem `{ "error": { "message": "Internal server error" }, "requestId": "..." }`, sem detalhes internos.
- **Rate limit**: em memória por padrão; com `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` passa a ser distribuído.

## Deploy na Vercel

1. Importe o repositório na Vercel e configure as variáveis obrigatórias.
2. O build padrão (`next build`) já basta, sem nenhum `vercel.json`.
3. Migrations não rodam no build: aplique com `pnpm prisma:migrate:deploy` antes de promover uma versão que altere `prisma/migrations/`.

## Contribuição e segurança

Veja `CONTRIBUTING.md` e `SECURITY.md`. Use Conventional Commits.

## Apoie o projeto

[Patrocine o ModelHub pelo GitHub Sponsors](https://github.com/sponsors/actus7).

## Licença

MIT. Veja `LICENSE`.
