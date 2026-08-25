import { describe, expect, it } from "vitest"

import { providerLogoSrc } from "./provider-logos"

describe("providerLogoSrc", () => {
  it("returns the static asset path for a provider with a logo", () => {
    expect(providerLogoSrc("openai")).toBe("/providers/openai.svg")
  })

  it("returns undefined for a provider without a logo", () => {
    expect(providerLogoSrc("puter")).toBeUndefined()
  })
})
