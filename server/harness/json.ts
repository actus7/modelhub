import type { Prisma } from "../../generated/prisma/client"

const MAX_JSON_BYTES = 1_000_000

export function toHarnessJson(value: unknown): Prisma.InputJsonValue {
  const seen = new WeakSet<object>()
  const serialized = JSON.stringify(value ?? null, (_key, current: unknown) => {
    if (typeof current === "bigint") return current.toString()
    if (current instanceof Date) return current.toISOString()
    if (current instanceof Error) {
      return { message: current.message, name: current.name, stack: current.stack?.slice(0, 8_000) }
    }
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return "[Circular]"
      seen.add(current)
    }
    return current
  })
  if (!serialized) return { value: null }
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    return { error: "Harness payload exceeded the 1 MB persistence limit", truncated: true }
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}
