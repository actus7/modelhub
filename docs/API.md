# 📡 Documentação da API

API compatível com OpenAI para acesso unificado a múltiplos provedores de IA.

## 🔑 Autenticação

Todas as requisições requerem autenticação via Bearer token:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Obter API Key

1. Faça login em https://www.modelhub.com.br
2. Vá para Settings → API Keys
3. Clique em "Create New Key"
4. Copie e guarde sua chave (não será mostrada novamente)

## 📋 Base URL

```
https://www.modelhub.com.br/v1
```

## 🚀 Endpoints

### Chat Completions

Cria uma completion de chat.

**Endpoint:** `POST /v1/chat/completions`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

**Body:**
```json
{
  "model": "quillbot/quillbot-ai",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**Parâmetros:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `model` | string | Sim | ID no formato `provider/model-id` (ex: `groq/llama-3.3-70b-versatile`) |
| `messages` | array | Sim | Array de mensagens |
| `temperature` | number | Não | 0-2, padrão 1 |
| `max_tokens` | number | Não | Máximo de tokens na resposta |
| `stream` | boolean | Não | Se true, retorna stream SSE |
| `top_p` | number | Não | 0-1, padrão 1 |
| `frequency_penalty` | number | Não | -2 a 2, padrão 0 |
| `presence_penalty` | number | Não | -2 a 2, padrão 0 |

**Resposta (não-stream):**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**Resposta (stream):**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Listar Modelos

Lista todos os modelos disponíveis.

**Endpoint:** `GET /v1/models`

**Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Resposta:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1677610602,
      "owned_by": "openai",
      "provider": "openai"
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "object": "model",
      "created": 1677610602,
      "owned_by": "anthropic",
      "provider": "anthropic"
    }
  ]
}
```

### Obter Modelo

Obtém informações sobre um modelo específico.

**Endpoint:** `GET /v1/models/{model_id}`

**Headers:**
```
Authorization: Bearer YOUR_API_KEY
```

**Resposta:**
```json
{
  "id": "gpt-4",
  "object": "model",
  "created": 1677610602,
  "owned_by": "openai",
  "provider": "openai",
  "capabilities": {
    "chat": true,
    "completion": true,
    "vision": true
  }
}
```

## 🔌 Provedores Suportados

### OpenAI

**Modelos:**
- `gpt-4-turbo`
- `gpt-4`
- `gpt-3.5-turbo`

**Formato do modelo:** `gpt-4`

### Anthropic

**Modelos:**
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

**Formato do modelo:** `claude-3-5-sonnet-20241022`

### Google AI

**Modelos:**
- `gemini-2.0-flash-exp`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

**Formato do modelo:** `gemini-2.0-flash-exp`

### Groq

**Modelos:**
- `llama-3.3-70b-versatile`
- `mixtral-8x7b-32768`

**Formato do modelo:** `llama-3.3-70b-versatile`

## 💡 Exemplos

### cURL

```bash
curl https://www.modelhub.com.br/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "quillbot/quillbot-ai",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://www.modelhub.com.br/v1"
)

response = client.chat.completions.create(
    model="quillbot/quillbot-ai",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript/TypeScript

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://www.modelhub.com.br/v1'
});

const response = await client.chat.completions.create({
  model: 'quillbot/quillbot-ai',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

### Streaming

```typescript
const stream = await client.chat.completions.create({
  model: 'quillbot/quillbot-ai',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

## ⚠️ Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 400 | Bad Request - Parâmetros inválidos |
| 401 | Unauthorized - API key inválida ou ausente |
| 403 | Forbidden - Sem permissão para acessar recurso |
| 404 | Not Found - Recurso não encontrado |
| 429 | Too Many Requests - Rate limit excedido |
| 500 | Internal Server Error - Erro no servidor |
| 502 | Bad Gateway - Erro no provedor upstream |
| 503 | Service Unavailable - Serviço temporariamente indisponível |

**Formato de Erro:**
```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

## 🚦 Rate Limiting

- **Limite padrão:** 100 requisições por minuto
- **Headers de resposta:**
  - `X-RateLimit-Limit`: Limite total
  - `X-RateLimit-Remaining`: Requisições restantes
  - `X-RateLimit-Reset`: Timestamp de reset

## 📊 Uso e Custos

Monitore seu uso em:
- Dashboard: https://www.modelhub.com.br/dashboard
- API: `GET /v1/usage`

## 🔒 Segurança

- Use HTTPS sempre
- Nunca exponha sua API key
- Rotacione keys regularmente
- Use variáveis de ambiente

## 📚 SDKs Compatíveis

Como a API é compatível com OpenAI, você pode usar qualquer SDK OpenAI:

- [OpenAI Python](https://github.com/openai/openai-python)
- [OpenAI Node.js](https://github.com/openai/openai-node)
- [OpenAI Go](https://github.com/sashabaranov/go-openai)
- [OpenAI Java](https://github.com/TheoKanning/openai-java)

## 🆘 Suporte

- Documentação: https://docs.modelhub.dev
- Issues: https://github.com/Geeks-Zone/modelhub/issues
- Email: api@modelhub.dev

---

**Versão da API:** v1  
**Última atualização:** 2026-04-13

