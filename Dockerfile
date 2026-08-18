FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@10.33.0 --activate


FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts


FROM base AS production-dependencies

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts


FROM base AS builder

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Prisma 7 writes the client to generated/prisma. Generation does not require
# a live database; prisma.config.ts supplies a non-secret fallback URL here.
RUN pnpm prisma:generate \
    && pnpm build


FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/logs \
    && chown node:node /app/logs

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/generated ./generated
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

CMD ["node_modules/.bin/next", "start"]
