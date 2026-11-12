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
pnpm lint | typecheck | test
pnpm prisma:generate | prisma:migrate | prisma:migrate:deploy
```

## Arquitetura

- **Next.js 16 (App Router)**: páginas, auth (Neon Auth, `proxy.ts`) e frontend (shadcn/ui, Tailwind 4).
- **Hono** (`server/app.ts`), montado via route handler: `/v1/*`, rotas por provedor e APIs do usuário.
- **Prisma 7 + Neon** (`server/lib/db.ts`, `prisma/schema.prisma`).
- `server/lib/openai-compatible.ts`: o único cliente de provedor. `server/lib/routing/`: roteamento automático.

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
