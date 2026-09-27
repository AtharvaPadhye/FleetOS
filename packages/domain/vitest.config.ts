import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      // NFR MNT-2: packages/domain ≥ 90% lines.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
