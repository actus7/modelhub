import { prisma } from "./db";
import { logger } from "./logger";

const DATABASE_CHECK_TIMEOUT_MS = 3_000;
/** O endpoint é público: o resultado é reaproveitado para não virar martelo no banco. */
const READINESS_CACHE_TTL_MS = 5_000;

export type ReadinessReport = {
  status: "ok" | "unavailable";
  checks: { database: "ok" | "unavailable" };
};

let cached: { report: ReadinessReport; expiresAt: number } | undefined;

async function isDatabaseReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("database check timed out")),
          DATABASE_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch (error) {
    logger.error("health.database_unreachable", { error });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(now = Date.now()): Promise<ReadinessReport> {
  if (cached && cached.expiresAt > now) {
    return cached.report;
  }

  const database = (await isDatabaseReachable()) ? "ok" : "unavailable";
  const report: ReadinessReport = { status: database, checks: { database } };
  cached = { report, expiresAt: now + READINESS_CACHE_TTL_MS };
  return report;
}

export function resetReadinessCacheForTests(): void {
  cached = undefined;
}
