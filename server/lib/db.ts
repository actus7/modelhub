/**
 * Prisma client singleton for the API process.
 */

import "../env";
import { ensureRuntimeEnvValidated } from "../env";

import { PrismaNeonHttp } from "@prisma/adapter-neon";

import { PrismaClient } from "../../generated/prisma/client.ts";

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * Increment when `schema.prisma` changes in a way that requires a new PrismaClient
 * (e.g. new fields). Without this, `next dev` can keep a stale singleton in `globalThis`
 * after `pnpm prisma:generate` until a full server restart.
 */
const PRISMA_CLIENT_CACHE_REVISION = 3;

const globalForPrisma = globalThis as {
  __prisma?: PrismaClientInstance;
  __prismaClientCacheRevision?: number;
};

function createPrismaClient(): PrismaClientInstance {
  ensureRuntimeEnvValidated();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não definido");
  }

  const adapter = new PrismaNeonHttp(databaseUrl);
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClientInstance {
  if (globalForPrisma.__prismaClientCacheRevision !== PRISMA_CLIENT_CACHE_REVISION) {
    void globalForPrisma.__prisma?.$disconnect().catch(() => undefined);
    globalForPrisma.__prisma = undefined;
  }

  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createPrismaClient();
    globalForPrisma.__prismaClientCacheRevision = PRISMA_CLIENT_CACHE_REVISION;
  }

  return globalForPrisma.__prisma;
}

/**
 * Lazy Prisma proxy to avoid touching DATABASE_URL during Next.js build-time module evaluation.
 */
export const prisma: PrismaClientInstance = new Proxy({} as PrismaClientInstance, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
