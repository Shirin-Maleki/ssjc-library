import { describe, expect, it } from "vitest";
import { CHUNK_SIZE_BYTES } from "@/lib/intake/uploadChunking";

/** Real, current constraints this constant must satisfy (Phase 7 correction
 * pass §1) — not just "some number," a specifically bounded one. */
describe("intake/uploadChunking — CHUNK_SIZE_BYTES", () => {
  const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;
  const GOOGLE_RESUMABLE_CHUNK_GRANULARITY_BYTES = 256 * 1024;

  it("stays comfortably under Vercel's real 4.5 MB serverless Function request-body limit", () => {
    expect(CHUNK_SIZE_BYTES).toBeLessThan(VERCEL_FUNCTION_BODY_LIMIT_BYTES);
    // "Comfortably" — leaves real headroom for headers, not a hair's-width margin.
    expect(VERCEL_FUNCTION_BODY_LIMIT_BYTES - CHUNK_SIZE_BYTES).toBeGreaterThan(256 * 1024);
  });

  it("is a multiple of Google's required 256 KiB resumable-upload chunk granularity", () => {
    expect(CHUNK_SIZE_BYTES % GOOGLE_RESUMABLE_CHUNK_GRANULARITY_BYTES).toBe(0);
  });

  it("is the documented 4 MiB", () => {
    expect(CHUNK_SIZE_BYTES).toBe(4 * 1024 * 1024);
  });
});
