import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/**",
      "**/manifest-main/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["lib/**/*.ts", "server/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "server/tests/**",
        "generated/**",
      ],
      thresholds: {
        // Baseline real da suíte atual; subir estes números junto com novos testes.
        statements: 38,
        branches: 28,
        functions: 35,
        lines: 40,
      },
    },
  },
});
