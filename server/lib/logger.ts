/**
 * Logger estruturado do servidor: uma linha JSON por evento em stdout/stderr,
 * que é o formato que a Vercel (e qualquer coletor de logs) indexa.
 *
 * - `LOG_LEVEL` (debug|info|warn|error|silent) define o nível mínimo; o padrão
 *   é `info`, e `silent` em testes.
 * - O `requestId` da requisição em curso é anexado automaticamente via
 *   AsyncLocalStorage (ver `runWithRequestContext`).
 * - Mensagens e stacks de erro passam por `scrubSecrets` antes de sair.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { scrubSecrets } from "./secret-scrub";

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

type ConfigurableLevel = keyof typeof LEVEL_WEIGHT;
type LogLevel = Exclude<ConfigurableLevel, "silent">;
type LogFields = Record<string, unknown>;
type RequestContext = { requestId: string };

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

function resolveMinWeight(): number {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured && configured in LEVEL_WEIGHT) {
    return LEVEL_WEIGHT[configured as ConfigurableLevel];
  }

  return process.env.NODE_ENV === "test" ? LEVEL_WEIGHT.silent : LEVEL_WEIGHT.info;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: scrubSecrets(value.message),
      name: value.name,
      stack: value.stack ? scrubSecrets(value.stack) : undefined,
    };
  }

  return value;
}

function write(level: LogLevel, event: string, fields?: LogFields): void {
  if (LEVEL_WEIGHT[level] < resolveMinWeight()) {
    return;
  }

  const entry: LogFields = {
    level,
    time: new Date().toISOString(),
    event,
    requestId: getRequestId(),
  };
  for (const [key, value] of Object.entries(fields ?? {})) {
    entry[key] = serializeValue(value);
  }

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    // Campo não serializável (ciclo, BigInt): não perder o evento por causa dele.
    line = JSON.stringify({ level, time: entry.time, event, requestId: entry.requestId, unserializable: true });
  }

  console[level](line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
