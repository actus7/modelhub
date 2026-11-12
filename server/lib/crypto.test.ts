import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey } from "./crypto";

describe("crypto helpers", () => {
  it("generates api keys with stable hash output", () => {
    const generated = generateApiKey();

    expect(generated.raw.startsWith("sk-")).toBe(true);
    expect(generated.prefix.startsWith("sk-")).toBe(true);
    expect(generated.hash).toBe(hashApiKey(generated.raw));
  });
});
