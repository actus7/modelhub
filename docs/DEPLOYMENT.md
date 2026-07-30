# 🚀 Guia de Deploy

Este guia cobre diferentes opções de deploy para o ModelHub.

## 📋 Índice

- [Pré-requisitos](#pré-requisitos)
- [Vercel (Recomendado)](#vercel-recomendado)
- [Docker](#docker)
- [VPS/Cloud](#vpscloud)
- [Configuração Pós-Deploy](#configuração-pós-deploy)

## ✅ Pré-requisitos

Antes de fazer deploy, você precisa:

1. **Banco de Dados Neon**
   - Crie uma conta em [neon.tech](https://neon.tech)
   - Crie um novo projeto
   - Copie as connection strings (pooled e direct)

2. **Neon Auth**
   - Configure Neon Auth no seu projeto
   - Obtenha `NEON_AUTH_BASE_URL`
   - Gere `NEON_AUTH_COOKIE_SECRET`

3. **Encryption Key**
   ```bash
   openssl rand -hex 32
   ```

4. **API Keys dos Provedores** (opcional)
   - OpenAI, Anthropic, Google, etc.

## ☁️ Vercel (Recomendado)

### Deploy com um Clique

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/actus7/modelhub)

### Deploy Manual

1. **Instale Vercel CLI**
   ```bash
   pnpm add -g vercel
   ```

2. **Login**
   ```bash
   vercel login
   ```

3. **Configure Variáveis de Ambiente**
   ```bash
   vercel env add DATABASE_URL
   vercel env add DIRECT_URL
   vercel env add NEON_AUTH_BASE_URL
   vercel env add NEON_AUTH_COOKIE_SECRET
   vercel env add ENCRYPTION_KEY
   ```

4. **Deploy**
   ```bash
   vercel --prod
   ```

### Configuração Vercel

**vercel.json:**
```json
{
  "buildCommand": "pnpm build:vercel",
  "installCommand": "pnpm install",
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "DATABASE_URL": "@database-url",
    "DIRECT_URL": "@direct-url",
    "NEON_AUTH_BASE_URL": "@neon-auth-base-url",
    "NEON_AUTH_COOKIE_SECRET": "@neon-auth-cookie-secret",
    "ENCRYPTION_KEY": "@encryption-key"
  }
}
```

### Migrações no Vercel

As migrações são executadas automaticamente durante o build via `scripts/vercel-build.mjs`.

## 🐳 Docker

### Build da Imagem

```bash
docker build -t modelhub:latest .
```

### Executar Container

```bash
docker run -d \
  --name modelhub \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e DIRECT_URL="postgresql://..." \
  -e NEON_AUTH_BASE_URL="https://..." \
  -e NEON_AUTH_COOKIE_SECRET="..." \
  -e ENCRYPTION_KEY="..." \
  modelhub:latest
```

### Docker Compose

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  modelhub:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - DIRECT_URL=${DIRECT_URL}
      - NEON_AUTH_BASE_URL=${NEON_AUTH_BASE_URL}
      - NEON_AUTH_COOKIE_SECRET=${NEON_AUTH_COOKIE_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Executar:**
```bash
docker-compose up -d
```

### Dockerfile

```dockerfile
FROM node:22-alpine AS base

# Instalar pnpm
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

# Dependências
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Produção
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

## 🖥️ VPS/Cloud

### Requisitos do Servidor

- **CPU:** 2+ cores
- **RAM:** 2GB+ (4GB recomendado)
- **Storage:** 10GB+
- **OS:** Ubuntu 22.04 LTS (recomendado)

### Setup Inicial

1. **Atualizar Sistema**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Instalar Node.js 22**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. **Instalar pnpm**
   ```bash
   npm install -g pnpm
   ```

4. **Instalar Git**
   ```bash
   sudo apt install -y git
   ```

### Deploy da Aplicação

1. **Clonar Repositório**
   ```bash
   cd /var/www
   git clone https://github.com/actus7/modelhub.git
   cd modelhub
   ```

2. **Instalar Dependências**
   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Configurar Variáveis de Ambiente**
   ```bash
   cp .env.example .env
   nano .env
   # Configure todas as variáveis
   ```

4. **Executar Migrações**
   ```bash
   pnpm prisma:migrate:deploy
   ```

5. **Build**
   ```bash
   pnpm build
   ```

6. **Iniciar Aplicação**
   ```bash
   pnpm start
   ```

### PM2 (Process Manager)

1. **Instalar PM2**
   ```bash
   npm install -g pm2
   ```

2. **Criar ecosystem.config.js**
   ```javascript
   module.exports = {
     apps: [{
       name: 'modelhub',
       script: 'node_modules/next/dist/bin/next',
       args: 'start',
       cwd: '/var/www/modelhub',
       instances: 'max',
       exec_mode: 'cluster',
       env: {
         NODE_ENV: 'production',
         PORT: 3000
       }
     }]
   };
   ```

3. **Iniciar com PM2**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### Nginx (Reverse Proxy)

1. **Instalar Nginx**
   ```bash
   sudo apt install -y nginx
   ```

2. **Configurar Site**
   ```bash
   sudo nano /etc/nginx/sites-available/modelhub
   ```

   ```nginx
   server {
       listen 80;
       server_name seu-dominio.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. **Ativar Site**
   ```bash
   sudo ln -s /etc/nginx/sites-available/modelhub /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

### SSL com Let's Encrypt

1. **Instalar Certbot**
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```

2. **Obter Certificado**
   ```bash
   sudo certbot --nginx -d seu-dominio.com
   ```

3. **Auto-renovação**
   ```bash
   sudo certbot renew --dry-run
   ```

## ⚙️ Configuração Pós-Deploy

### 1. Verificar Health

```bash
curl https://seu-dominio.com/health
```

### 2. Criar Primeiro Usuário

Acesse `https://seu-dominio.com/auth/signup`

### 3. Configurar Credenciais

1. Login
2. Vá para Settings
3. Adicione API keys dos provedores

### 4. Testar API

```bash
curl https://seu-dominio.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## 📊 Monitoramento

### Logs

**Vercel:**
```bash
vercel logs
```

**Docker:**
```bash
docker logs -f modelhub
```

**PM2:**
```bash
pm2 logs modelhub
```

### Métricas

- Vercel Analytics
- PM2 Monitoring: `pm2 monit`
- Custom: Integre com Prometheus/Grafana

## 🔄 Atualizações

### Vercel

```bash
git pull origin main
vercel --prod
```

### Docker

```bash
git pull origin main
docker-compose down
docker-compose build
docker-compose up -d
```

### VPS

```bash
cd /var/www/modelhub
git pull origin main
pnpm install
pnpm prisma:migrate:deploy
pnpm build
pm2 restart modelhub
```

## 🔒 Segurança

### Checklist

- [ ] HTTPS habilitado
- [ ] Variáveis de ambiente seguras
- [ ] Firewall configurado
- [ ] Rate limiting ativo
- [ ] CORS configurado
- [ ] Backups automáticos
- [ ] Logs de auditoria
- [ ] Atualizações regulares

### Firewall (UFW)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 🆘 Troubleshooting

### Build Falha

```bash
# Limpar cache
rm -rf .next node_modules
pnpm install
pnpm build
```

### Erro de Conexão com Banco

```bash
# Testar conexão
pnpm prisma db pull
```

### Porta em Uso

```bash
# Encontrar processo
lsof -i :3000
# Matar processo
kill -9 PID
```

## 📚 Recursos

- [Vercel Docs](https://vercel.com/docs)
- [Docker Docs](https://docs.docker.com/)
- [Nginx Docs](https://nginx.org/en/docs/)
- [PM2 Docs](https://pm2.keymetrics.io/docs/)

---

**Precisa de ajuda?** Abra uma [issue](https://github.com/actus7/modelhub/issues)
