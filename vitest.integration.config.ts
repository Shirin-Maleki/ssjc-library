import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * A separate config from `vitest.config.ts` deliberately — these tests need a real
 * Postgres connection (`TEST_DATABASE_URL`) and must never run as part of the default
 * `npm test` (which stays fast, DB-free, and safe to run anywhere). See
 * docs/DATABASE_SETUP.md for how to point this at a real test database; each test
 * file skips itself gracefully (not a failure) when `TEST_DATABASE_URL` is unset.
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
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
    // Integration tests share one real database and must not interleave.
    fileParallelism: false,
  },
});
