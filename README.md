<p align="right"><a href="README_EN.md">English</a></p>

# 🚀 ModelHub

<div align="center">

![ModelHub Logo](https://img.shields.io/badge/ModelHub-AI%20Gateway-blue?style=for-the-badge)

**Hub unificado para múltiplos modelos de IA com API compatível OpenAI**

[![CI](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml/badge.svg)](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Geeks-Zone/modelhub/pulls)
[![GitHub Stars](https://img.shields.io/github/stars/Geeks-Zone/modelhub)](https://github.com/Geeks-Zone/modelhub/stargazers)

[Funcionalidades](#-funcionalidades) •
[Instalação](#-instalação) •
[Documentação](#-documentação) •
[Contribuir](#-contribuindo) •
[Licença](#-licença)

</div>

---

## 📋 Sobre

ModelHub é uma plataforma open-source que unifica o acesso a múltiplos provedores de IA (OpenAI, Anthropic, Google, Groq, Mistral e outros) através de uma única API compatível com OpenAI. Inclui interface de chat integrada, gerenciamento seguro de credenciais e sistema de autenticação robusto.

### ✨ Funcionalidades

- 🔌 **API Gateway Unificada** - Interface compatível com OpenAI para múltiplos provedores
- 💬 **Chat Integrado** - Interface web moderna para interagir com modelos de IA
- 🔐 **Autenticação Segura** - Sistema completo com Neon Auth
- 🔑 **Gerenciamento de Credenciais** - Armazenamento criptografado de API keys
- 📊 **Dashboard de Uso** - Monitore consumo e custos em tempo real
- 📎 **Suporte a Anexos** - Upload de imagens, PDFs e documentos
- 🌐 **Multi-tenant** - Suporte para múltiplos usuários e organizações
- 🚀 **Deploy Fácil** - Pronto para Vercel, Docker e outras plataformas
- 📝 **TypeScript** - Totalmente tipado para melhor DX
- 🧪 **Testado** - Cobertura de testes com Vitest

### 🎯 Provedores Suportados

- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google AI (Gemini Pro, Gemini Flash)
- Groq (Llama, Mixtral)
- Mistral AI
- Cohere
- HuggingFace
- OpenRouter
- Vercel AI Gateway

## 🚀 Instalação

### Pré-requisitos

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Conta no [Neon](https://neon.tech) (PostgreSQL serverless)
- API keys dos provedores que deseja usar

### Instalação Rápida

```bash
# Clone o repositório
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub

# Instale as dependências
pnpm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Execute as migrações do banco de dados
pnpm prisma:migrate

# Inicie o servidor de desenvolvimento
pnpm dev
```

Acesse http://localhost:3000

### 🐳 Docker

```bash
# Build da imagem
docker build -t modelhub .

# Execute o container
docker run -p 3000:3000 --env-file .env modelhub
```

### ☁️ Deploy na Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Geeks-Zone/modelhub)

1. Clique no botão acima
2. Configure as variáveis de ambiente
3. Deploy!

## 📖 Documentação

### Configuração

#### Variáveis de Ambiente

Veja [.env.example](.env.example) para todas as opções disponíveis.

**Obrigatórias:**
```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
NEON_AUTH_BASE_URL="https://..."
NEON_AUTH_COOKIE_SECRET="..."
ENCRYPTION_KEY="..."
```

**Opcionais:**
```env
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_AI_STUDIO_API_KEY="..."
```

#### Banco de Dados

O projeto usa Prisma com PostgreSQL (Neon):

```bash
# Gerar cliente Prisma
pnpm prisma:generate

# Executar migrações
pnpm prisma:migrate

# Push schema (desenvolvimento)
pnpm prisma:push
```

### Uso da API

#### Endpoint de Chat

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "openrouter/openai/gpt-oss-20b:free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Listar Modelos

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Desenvolvimento

```bash
# Desenvolvimento
pnpm dev

# Build
pnpm build

# Testes
pnpm test

# Lint
pnpm lint

# Type check
pnpm typecheck
```

## 🏗️ Arquitetura

```
modelhub/
├── app/                    # Next.js App Router
│   ├── (app)/             # Rotas autenticadas
│   ├── api/               # API routes
│   └── auth/              # Autenticação
├── components/            # Componentes React
│   ├── chat/             # Interface de chat
│   ├── dashboard/        # Dashboard
│   └── ui/               # Componentes UI (shadcn)
├── lib/                   # Utilitários e lógica
│   ├── auth/             # Autenticação
│   └── chat-stream.ts    # Streaming de chat
├── prisma/               # Schema e migrações
├── server/               # Lógica do servidor (Hono)
└── scripts/              # Scripts de build e deploy
```

## 🤝 Contribuindo

Contribuições são muito bem-vindas! Veja [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes.

### Como Contribuir

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### Código de Conduta

Este projeto adota o [Contributor Covenant](CODE_OF_CONDUCT.md). Ao participar, você concorda em seguir seus termos.

## 🐛 Reportar Bugs

Encontrou um bug? Por favor, abra uma [issue](https://github.com/Geeks-Zone/modelhub/issues) com:

- Descrição clara do problema
- Passos para reproduzir
- Comportamento esperado vs atual
- Screenshots (se aplicável)
- Ambiente (OS, Node version, etc.)

## 🔒 Segurança

Para reportar vulnerabilidades de segurança, veja [SECURITY.md](SECURITY.md).

## 📝 Licença

Este projeto está licenciado sob a Licença MIT - veja [LICENSE](LICENSE) para detalhes.

## 🙏 Agradecimentos

- [Next.js](https://nextjs.org/) - Framework React
- [Prisma](https://www.prisma.io/) - ORM
- [Neon](https://neon.tech/) - PostgreSQL Serverless
- [shadcn/ui](https://ui.shadcn.com/) - Componentes UI
- [Hono](https://hono.dev/) - Framework web
- Todos os [contribuidores](https://github.com/Geeks-Zone/modelhub/graphs/contributors)

## 📞 Suporte

- 📧 Email: support@modelhub.dev
- 💬 Discord: [Join our community](https://discord.gg/modelhub)
- 🐦 Twitter: [@modelhub](https://twitter.com/modelhub)
- 📖 Docs: [docs.modelhub.dev](https://docs.modelhub.dev)

## 🗺️ Roadmap

- [ ] Suporte a mais provedores (Perplexity, Together AI)
- [ ] Sistema de plugins
- [ ] Análise de custos avançada
- [ ] Suporte a embeddings
- [ ] API de fine-tuning
- [ ] Mobile app
- [ ] Integração com Langchain/LlamaIndex

---

<div align="center">

**[⬆ Voltar ao topo](#-modelhub)**

Feito com ❤️ pela comunidade ModelHub

</div>

