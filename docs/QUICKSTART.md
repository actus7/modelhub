# ⚡ Guia de Início Rápido

Comece a usar o ModelHub em menos de 5 minutos!

## 🎯 Pré-requisitos

Antes de começar, certifique-se de ter:

- ✅ Node.js >= 22.0.0 ([Download](https://nodejs.org))
- ✅ pnpm >= 10.0.0 (`npm install -g pnpm`)
- ✅ Git ([Download](https://git-scm.com))
- ✅ Conta no [Neon](https://neon.tech) (gratuita)

## 🚀 Instalação em 3 Passos

### 1️⃣ Clone e Instale

```bash
# Clone o repositório
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub

# Instale as dependências
pnpm install
```

### 2️⃣ Configure o Banco de Dados

**a) Crie um projeto no Neon:**
1. Acesse [console.neon.tech](https://console.neon.tech)
2. Clique em "Create Project"
3. Escolha um nome e região
4. Copie as connection strings

**b) Configure as variáveis de ambiente:**

```bash
# Copie o arquivo de exemplo
cp .env.example .env

# Edite o arquivo .env
nano .env  # ou use seu editor favorito
```

**Variáveis obrigatórias:**
```env
# Cole suas connection strings do Neon
DATABASE_URL="postgresql://user:pass@host-pooler.region.aws.neon.tech/dbname?sslmode=require"
DIRECT_URL="postgresql://user:pass@host.region.aws.neon.tech/dbname?sslmode=require"

# Configure Neon Auth (veja docs do Neon)
NEON_AUTH_BASE_URL="https://your-project.neonauth.region.aws.neon.tech/dbname/auth"

# Gere um secret aleatório (32+ caracteres)
NEON_AUTH_COOKIE_SECRET="seu-secret-aleatorio-aqui"

# Gere uma chave de criptografia
ENCRYPTION_KEY="sua-chave-64-caracteres-hex-aqui"
```

**Gerar chaves:**
```bash
# NEON_AUTH_COOKIE_SECRET (32+ caracteres)
openssl rand -base64 32

# ENCRYPTION_KEY (64 caracteres hex)
openssl rand -hex 32
```

**c) Execute as migrações:**

```bash
pnpm prisma:migrate
```

### 3️⃣ Inicie o Servidor

```bash
# Modo desenvolvimento
pnpm dev
```

Acesse: http://localhost:3000 🎉

## 🎨 Primeiro Uso

### 1. Criar Conta

1. Acesse http://localhost:3000
2. Clique em "Sign Up"
3. Preencha email e senha
4. Faça login

### 2. Adicionar Credenciais

1. Vá para **Settings** (⚙️)
2. Clique em **Credentials**
3. Selecione um provedor (ex: OpenAI)
4. Cole sua API key
5. Clique em **Save**

**Onde obter API keys:**
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Anthropic: [console.anthropic.com](https://console.anthropic.com)
- Google: [makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey)
- Groq: [console.groq.com/keys](https://console.groq.com/keys)

### 3. Começar a Conversar

1. Vá para **Chat** (💬)
2. Selecione um modelo
3. Digite sua mensagem
4. Pressione Enter ou clique em Enviar

Pronto! Você está usando o ModelHub! 🚀

## 🔌 Usar a API

### 1. Criar API Key

1. Vá para **Settings** → **API Keys**
2. Clique em **Create New Key**
3. Dê um nome (ex: "Meu App")
4. Copie a key (não será mostrada novamente!)

### 2. Fazer Primeira Requisição

**cURL:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Olá!"}
    ]
  }'
```

**Python:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="SUA_API_KEY",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Olá!"}]
)

print(response.choices[0].message.content)
```

**JavaScript:**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'SUA_API_KEY',
  baseURL: 'http://localhost:3000/v1'
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Olá!' }]
});

console.log(response.choices[0].message.content);
```

## 🎯 Próximos Passos

### Explore as Features

- 📎 **Anexos**: Envie imagens e documentos no chat
- 📊 **Dashboard**: Monitore uso e custos
- 🔄 **Streaming**: Respostas em tempo real
- 🔗 **Compartilhar**: Compartilhe conversas com outros

### Aprenda Mais

- 📖 [Documentação Completa](../README.md)
- 🔌 [Guia da API](API.md)
- 💡 [Exemplos](EXAMPLES.md)
- ❓ [FAQ](FAQ.md)

### Deploy em Produção

- ☁️ [Deploy na Vercel](DEPLOYMENT.md#vercel-recomendado)
- 🐳 [Deploy com Docker](DEPLOYMENT.md#docker)
- 🖥️ [Deploy em VPS](DEPLOYMENT.md#vpscloud)

## 🆘 Problemas Comuns

### Erro: "Cannot connect to database"

**Solução:**
1. Verifique se `DATABASE_URL` e `DIRECT_URL` estão corretas
2. Teste a conexão: `pnpm prisma db pull`
3. Verifique se o banco está acessível

### Erro: "Invalid API key"

**Solução:**
1. Verifique se copiou a key completa
2. Verifique se a key não expirou
3. Teste a key diretamente no site do provedor

### Erro: "Port 3000 already in use"

**Solução:**
```bash
# Encontre o processo
lsof -i :3000

# Mate o processo
kill -9 PID

# Ou use outra porta
PORT=3001 pnpm dev
```

### Build falha

**Solução:**
```bash
# Limpe tudo
rm -rf .next node_modules

# Reinstale
pnpm install

# Tente novamente
pnpm build
```

## 💡 Dicas

### Performance

- Use **Groq** para respostas ultra-rápidas
- Use **GPT-3.5** para economia
- Use **streaming** para melhor UX

### Segurança

- Nunca commite arquivos `.env`
- Use HTTPS em produção
- Rotacione API keys regularmente
- Configure rate limiting

### Desenvolvimento

- Use `pnpm dev` para hot reload
- Use `pnpm lint` antes de commitar
- Use `pnpm test` para rodar testes
- Use `pnpm typecheck` para verificar tipos

## 🎓 Tutoriais

### Tutorial 1: Chatbot Simples

```python
from openai import OpenAI

client = OpenAI(
    api_key="SUA_API_KEY",
    base_url="http://localhost:3000/v1"
)

def chat(message, history=[]):
    history.append({"role": "user", "content": message})
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=history
    )
    
    assistant_message = response.choices[0].message.content
    history.append({"role": "assistant", "content": assistant_message})
    
    return assistant_message, history

# Uso
history = []
response, history = chat("Olá!", history)
print(response)

response, history = chat("Como você está?", history)
print(response)
```

### Tutorial 2: Comparar Modelos

```python
models = ["gpt-4", "claude-3-5-sonnet-20241022", "gemini-2.0-flash-exp"]
prompt = "Explique IA em uma frase."

for model in models:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    print(f"{model}: {response.choices[0].message.content}")
```

### Tutorial 3: Streaming

```python
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Conte uma história"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## 📚 Recursos

- [Documentação](../README.md)
- [API Reference](API.md)
- [Examples](EXAMPLES.md)
- [FAQ](FAQ.md)
- [Discord](https://discord.gg/modelhub)

## 🤝 Precisa de Ajuda?

- 💬 [Discord Community](https://discord.gg/modelhub)
- 🐛 [Report Issues](https://github.com/Geeks-Zone/modelhub/issues)
- 💡 [Discussions](https://github.com/Geeks-Zone/modelhub/discussions)
- 📧 [Email](mailto:support@modelhub.dev)

---

**Pronto para começar?** 🚀

```bash
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub
pnpm install
cp .env.example .env
# Configure .env
pnpm prisma:migrate
pnpm dev
```

**Divirta-se construindo com IA! 🎉**

