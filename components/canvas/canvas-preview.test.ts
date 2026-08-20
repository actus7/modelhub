import { describe, expect, it } from "vitest";
import { transform } from "@babel/standalone";

import {
  buildMermaidConfig,
  buildSandboxedHtmlDocument,
  escapeInlineScript,
} from "./canvas-preview";

describe("canvas preview sandbox", () => {
  it("injects the restrictive CSP before content in a complete document", () => {
    const result = buildSandboxedHtmlDocument(
      "<!doctype html><html><head><script>window.test = true</script></head><body>ok</body></html>",
    );

    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(result.indexOf("<script>"));
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
  });

  it("wraps fragments in a complete sandboxed document", () => {
    const result = buildSandboxedHtmlDocument("<main>Olá</main>");

    expect(result).toMatch(/^<!doctype html><html><head>/);
    expect(result).toContain("<body><main>Olá</main></body>");
  });

  it("prevents compiled source from terminating the runtime script element", () => {
    expect(escapeInlineScript('const value = "</ScRiPt><p>escape</p>";')).toBe(
      'const value = "<\\/script><p>escape</p>";',
    );
  });

  it("suppresses Mermaid's body-level error renderer", () => {
    expect(buildMermaidConfig("dark")).toMatchObject({
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
    });
  });

  it("compiles React imports into the preview require shim", () => {
    const code = transform(
      'import React, { useState } from "react"; export default function App(){ const [n] = useState(1); return <p>{n}</p> }',
      {
        filename: "canvas.tsx",
        plugins: ["transform-modules-commonjs"],
        presets: ["react", "typescript"],
      },
    ).code;

    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).toContain('require("react")');
  });
});
