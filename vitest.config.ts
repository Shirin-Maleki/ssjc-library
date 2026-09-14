import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Phase 1's unit tests are pure logic (auth/session/validation) with no DOM
    // dependency. jsdom is available per-file via a `// @vitest-environment jsdom`
    // pragma if a later phase adds component tests that need it — using it globally
    // here caused jose's WebCrypto key handling to see cross-realm Uint8Array
    // instances and fail spuriously.
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
