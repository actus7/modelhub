# Dockerfile para ModelHub
# Build otimizado multi-stage para produção

# Stage 1: Base
FROM node:22-alpine AS base

# Instalar pnpm
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

# Instalar dependências necessárias
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Stage 2: Dependências
FROM base AS deps

# Copiar arquivos de dependências
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts .

# Instalar dependências de produção e desenvolvimento
RUN pnpm install --frozen-lockfile

# Stage 3: Builder
FROM base AS builder

WORKDIR /app

# Copiar dependências do stage anterior
COPY --from=deps /app/node_modules ./node_modules

# Copiar código fonte
COPY . .

# Gerar Prisma Client
RUN pnpm prisma:generate

# Build da aplicação Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Variáveis de build (valores dummy para build)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV NEON_AUTH_BASE_URL="https://dummy.neon.tech"
ENV NEON_AUTH_COOKIE_SECRET="dummy-secret-32-characters-long"
ENV ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

RUN pnpm build

# Stage 4: Runner (Produção)
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copiar arquivos necessários
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Copiar build do Next.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copiar node_modules necessários (incluindo Prisma Client)
# Prisma 7.x gera o client em @prisma/client/, não em .prisma/
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copiar Prisma Client gerado (output customizado em generated/prisma)
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated

USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
