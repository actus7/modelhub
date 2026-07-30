# ❓ Perguntas Frequentes (FAQ)

## 📋 Índice

- [Geral](#geral)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [API](#api)
- [Provedores](#provedores)
- [Segurança](#segurança)
- [Troubleshooting](#troubleshooting)

## 🌟 Geral

### O que é o ModelHub?

ModelHub é uma plataforma open-source que unifica o acesso a múltiplos provedores de IA (OpenAI, Anthropic, Google, etc.) através de uma única API compatível com OpenAI. Inclui interface de chat, gerenciamento de credenciais e sistema de autenticação.

### Por que usar o ModelHub?

- **Unificação**: Uma API para todos os provedores
- **Economia**: Compare preços e escolha o melhor custo-benefício
- **Flexibilidade**: Troque de provedor sem mudar código
- **Privacidade**: Suas credenciais ficam no seu servidor
- **Open Source**: Código aberto, auditável e customizável

### É gratuito?

Sim, o ModelHub é 100% gratuito e open-source (licença MIT). Você só paga pelas APIs dos provedores que usar (OpenAI, Anthropic, etc.).

### Qual a diferença para outros gateways?

- **Self-hosted**: Você controla seus dados
- **Open Source**: Código auditável
- **Sem vendor lock-in**: Não depende de terceiros
- **Customizável**: Adapte às suas necessidades

## 🛠️ Instalação

### Quais são os requisitos?

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Conta no Neon (PostgreSQL serverless)
- API keys dos provedores que deseja usar

### Posso usar outro banco de dados?

O projeto é otimizado para Neon PostgreSQL, mas você pode adaptar para qualquer PostgreSQL >= 14. Será necessário ajustar as configurações de conexão.

### Funciona no Windows?

Sim! O ModelHub funciona em Windows, macOS e Linux.

### Posso usar npm ou yarn?

Recomendamos pnpm, mas você pode usar npm ou yarn. Será necessário ajustar os scripts no package.json.

## ⚙️ Configuração

### Como obter as credenciais do Neon?

1. Crie uma conta em [neon.tech](https://neon.tech)
2. Crie um novo projeto
3. Vá em "Connection Details"
4. Copie as connection strings (pooled e direct)

### Como gerar a ENCRYPTION_KEY?

```bash
openssl rand -hex 32
```

Isso gera uma chave de 64 caracteres hexadecimais.

### Preciso configurar todos os provedores?

Não! Configure apenas os provedores que você pretende usar. As API keys são opcionais e podem ser configuradas por usuário.

### Como funciona a autenticação?

O ModelHub usa Neon Auth, que fornece autenticação JWT segura com suporte a múltiplos provedores (email/senha, Google, GitHub, etc.).

## 💬 Uso

### Como criar uma conta?

1. Acesse `/auth/signup`
2. Preencha email e senha
3. Confirme o email (se configurado)
4. Faça login

### Como adicionar minhas API keys?

1. Faça login
2. Vá para Settings → Credentials
3. Selecione o provedor
4. Cole sua API key
5. Salve

As keys são criptografadas antes de serem salvas.

### Posso compartilhar conversas?

Sim! Cada conversa tem um botão de compartilhamento que gera um link público.

### Como anexar arquivos?

Clique no ícone de anexo (📎) no chat e selecione:
- Imagens (PNG, JPG, WebP)
- PDFs
- Documentos (DOCX, TXT)

### Há limite de mensagens?

Não há limite imposto pelo ModelHub. Os limites são dos provedores (rate limits, tokens, etc.).

## 🔌 API

### A API é compatível com OpenAI?

Sim! Você pode usar qualquer SDK OpenAI apontando para o ModelHub:

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://seu-modelhub.com/v1"
)
```

### Como obter uma API key?

1. Faça login
2. Vá para Settings → API Keys
3. Clique em "Create New Key"
4. Copie e guarde (não será mostrada novamente)

### Posso usar streaming?

Sim! Adicione `"stream": true` na requisição:

```json
{
  "model": "gpt-4",
  "messages": [...],
  "stream": true
}
```

### Há rate limiting?

Sim, configurável via variáveis de ambiente:
- `RATE_LIMIT_WINDOW_MS`: Janela de tempo (padrão: 60000ms)
- `RATE_LIMIT_MAX`: Máximo de requisições (padrão: 100)

## 🤖 Provedores

### Quais provedores são suportados?

- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude 3.5, Claude 3)
- Google AI (Gemini Pro, Flash)
- Groq (Llama, Mixtral)
- Mistral AI
- Cohere
- HuggingFace
- OpenRouter
- Vercel AI Gateway

### Como adicionar um novo provedor?

Veja [CONTRIBUTING.md](../CONTRIBUTING.md) para instruções sobre como adicionar novos provedores.

### Posso usar modelos locais?

Atualmente não, mas está no roadmap. Você pode contribuir com essa feature!

### Como escolher o melhor modelo?

Depende do seu caso de uso:
- **Qualidade máxima**: GPT-4, Claude 3.5 Sonnet
- **Velocidade**: Groq Llama, Gemini Flash
- **Custo-benefício**: GPT-3.5, Claude Haiku
- **Código**: GPT-4, Claude 3.5

## 🔒 Segurança

### Minhas API keys estão seguras?

Sim! As keys são:
- Criptografadas com AES-256
- Armazenadas no seu banco de dados
- Nunca expostas em logs
- Transmitidas apenas via HTTPS

### Posso auditar o código?

Sim! O código é 100% open-source. Você pode revisar, auditar e até fazer fork.

### Como reportar uma vulnerabilidade?

Veja [SECURITY.md](../SECURITY.md) para instruções sobre como reportar vulnerabilidades de forma responsável.

### Há autenticação de dois fatores?

Atualmente não, mas está planejado para versões futuras.

## 🔧 Troubleshooting

### Erro: "Database connection failed"

Verifique:
1. `DATABASE_URL` e `DIRECT_URL` estão corretas
2. Banco de dados está acessível
3. Credenciais estão corretas
4. Firewall não está bloqueando

### Erro: "Invalid API key"

Verifique:
1. API key foi copiada corretamente
2. Key não expirou
3. Provedor está ativo
4. Credenciais foram salvas

### Build falha no Vercel

Verifique:
1. Todas as variáveis de ambiente estão configuradas
2. Node version está correta (22+)
3. Logs de build para erros específicos

### Chat não carrega

Verifique:
1. JavaScript está habilitado
2. Console do navegador para erros
3. Conexão com internet
4. Servidor está rodando

### Streaming não funciona

Verifique:
1. Provedor suporta streaming
2. `stream: true` está na requisição
3. Cliente suporta SSE (Server-Sent Events)

### Como limpar o cache?

```bash
rm -rf .next node_modules
pnpm install
pnpm build
```

### Erro de CORS

Configure `ALLOWED_ORIGINS` no `.env`:

```env
ALLOWED_ORIGINS="https://seu-dominio.com,https://app.seu-dominio.com"
```

## 📚 Recursos Adicionais

- [Documentação Completa](../README.md)
- [Guia de API](API.md)
- [Guia de Deploy](DEPLOYMENT.md)
- [Arquitetura](ARCHITECTURE.md)
- [Issues no GitHub](https://github.com/actus7/modelhub/issues)

## 💬 Ainda tem dúvidas?

- Abra uma [Discussion](https://github.com/actus7/modelhub/discussions)
- Entre no [Discord](https://discord.gg/modelhub)
- Envie um email para support@modelhub.dev

---

**Não encontrou sua pergunta?** [Abra uma issue](https://github.com/actus7/modelhub/issues/new) ou contribua com esta FAQ!
