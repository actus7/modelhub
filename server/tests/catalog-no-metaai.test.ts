import { describe, expect, it } from "vitest";

import { PUTER_MODELS } from "@/lib/puter-models";
import { PROVIDER_CATALOG } from "../lib/catalog";

/**
 * O provider Meta AI foi removido (scraping não oficial, instável).
 */
describe("PROVIDER_CATALOG", () => {
  it("não inclui metaai", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(ids).not.toContain("metaai");
  });

  it("inclui Puter Xiaomi MiMo como provider gratuito client-side", () => {
    const provider = PROVIDER_CATALOG.find((p) => p.id === "puter");

    expect(provider).toMatchObject({
      base: "/puter",
      category: "browser-sdk",
      hasModels: true,
      label: "Puter Xiaomi MiMo",
      runtime: {
        authMode: "browser-session",
        externalApi: false,
        kind: "client",
        transport: "browser-sdk",
      },
    });
    expect(provider?.requiredKeys).toBeUndefined();
    expect(PUTER_MODELS.map((model) => model.id)).toEqual(["xiaomi/mimo-v2.5"]);
  });
});
