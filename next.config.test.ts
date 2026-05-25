import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next config", () => {
  it("runs as a single Next.js application without API rewrites", () => {
    expect(nextConfig.rewrites).toBeUndefined();
    expect(nextConfig.env).toBeUndefined();
    expect(nextConfig.reactCompiler).toBe(true);
  });
});
