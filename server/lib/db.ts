/**
 * Prisma client singleton for the API process.
 */

import "../env";
import { ensureRuntimeEnvValidated } from "../env";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../../generated/prisma/client.ts";

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as { __prisma?: PrismaClientInstance };

function createPrismaClient(): PrismaClientInstance {
  ensureRuntimeEnvValidated();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não definido");
  }

  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClientInstance {
  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createPrismaClient();
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
