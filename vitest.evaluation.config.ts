import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * A separate config from `vitest.config.ts` and `vitest.integration.config.ts` —
 * the search evaluation harness (`tests/evaluation/searchEvaluation.eval.ts`) needs
 * a real, seeded Postgres connection like the integration suite, but is a *report*
 * (recall/top-1/prohibited-violations against a committed dataset), not a unit of
 * correctness the default `npm test` should run on every change. See
 * `docs/SEARCH.md` §11 and `docs/DATABASE_SETUP.md`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/integration/globalSetup.ts"],
    setupFiles: ["./tests/integration/setupEnv.ts"],
    include: ["tests/evaluation/**/*.eval.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
