# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [2.0.0] - 2026-11-12

Versão de limpeza e padronização. **Quebra compatibilidade**: provedores, rotas e recursos foram removidos.

### Removido
- Provedores fora do padrão OpenAI-compatível com API key: Duck.ai, Quillbot, Puter, Pollinations, Xiaomi AI Studio (cookie), GitHub Copilot, Cloudflare Workers AI, Cohere e Ollama local
- Adaptações por provedor: transformação de body, fallback automático de modelo, prompt de sistema injetado, mensagens de erro por provedor, demo "labs" do Gateway
- Deploy em nuvem (OpenClaw/Railway/Render), custom-model-proxy, proxies de gateway/embeddings, infraestrutura OAuth/translators
- Dockerfile, build customizado da Vercel (migrations não rodam mais no build), dependências sem uso (puppeteer, jsdom, ws, @hono/zod-validator)

### Alterado
- Provedores declarados em uma tabela única (`server/providers/definitions.ts`) servida por um cliente OpenAI-compatível único
- Dependências atualizadas: Next 16.4.6, React 19.3.1, Prisma 7.10.1, @neondatabase/auth 0.7, mermaid 12, vitest 5
- Deploy na Vercel com o build padrão (`next build`); migrations aplicadas manualmente com `pnpm prisma:migrate:deploy`

### Adicionado
- Projetos, canvases versionados e artefatos persistidos, com compartilhamento, histórico de versões e respectivas migrações de banco.
- Bastidores das respostas de chat com roteamento, fallback, TTFT, estimativa de tokens por segundo e notas em reações.

### Segurança
- `better-auth` atualizado para `^1.7.22` (corrige advisory crítico); overrides reduzidos a correções pontuais de segurança.

## [1.0.0] - 2026-04-13

### Adicionado
- 🎉 Lançamento inicial do ModelHub
- 🔌 API Gateway unificada compatível com OpenAI
- 💬 Interface de chat integrada
- 🔐 Sistema de autenticação com Neon Auth
- 🔑 Gerenciamento seguro de credenciais (criptografadas)
- 📊 Dashboard de uso e monitoramento
- 📎 Suporte a anexos (imagens, PDFs, documentos)
- 🌐 Suporte multi-tenant
- 🚀 Deploy pronto para Vercel
- 📝 Documentação completa
- 🧪 Testes com Vitest

### Provedores Suportados
- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google AI (Gemini Pro, Gemini Flash)
- Groq (Llama, Mixtral)
- Mistral AI
- Cohere
- HuggingFace
- OpenRouter
- Vercel AI Gateway

### Tecnologias
- Next.js 16.2
- React 19.2
- TypeScript 5.x
- Prisma 7.5
- Neon PostgreSQL
- Hono 4.7
- Tailwind CSS 4
- shadcn/ui

---

## Tipos de Mudanças

- `Added` - Novas funcionalidades
- `Changed` - Mudanças em funcionalidades existentes
- `Deprecated` - Funcionalidades que serão removidas
- `Removed` - Funcionalidades removidas
- `Fixed` - Correções de bugs
- `Security` - Correções de vulnerabilidades

## Como Contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes sobre como contribuir com o projeto.

[Unreleased]: https://github.com/actus7/modelhub/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/actus7/modelhub/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/actus7/modelhub/releases/tag/v1.0.0
