import { describe, expect, it } from "vitest";
import { nextChunkEnd } from "@/components/add/uploadToSession";

/** Proves the client never asks to send a chunk larger than the given chunk
 * size, for real file sizes including ones larger than Vercel's real 4.5 MB
 * request-body limit (Phase 7 correction pass §1) — the whole reason chunking
 * exists at all. */
describe("components/add/uploadToSession — nextChunkEnd", () => {
  const CHUNK_SIZE = 4 * 1024 * 1024;

  it("never produces a chunk larger than chunkSizeBytes, across a full real upload sequence", () => {
    const totalSizeBytes = 6_400_000; // the real >4.5 MB JPEG size used in Phase 7 real-provider validation
    let offset = 0;
    let iterations = 0;
    while (offset < totalSizeBytes) {
      const end = nextChunkEnd(offset, totalSizeBytes, CHUNK_SIZE);
      expect(end - offset).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(end).toBeGreaterThan(offset); // always makes forward progress
      offset = end;
      iterations += 1;
      expect(iterations).toBeLessThan(100); // guards against an infinite loop bug
    }
    expect(offset).toBe(totalSizeBytes);
    expect(iterations).toBe(2); // 4 MiB + a smaller final chunk
  });

  it("never produces an oversized chunk for the full 25 MiB maximum allowed source size", () => {
    const totalSizeBytes = 25 * 1024 * 1024;
    let offset = 0;
    while (offset < totalSizeBytes) {
      const end = nextChunkEnd(offset, totalSizeBytes, CHUNK_SIZE);
      expect(end - offset).toBeLessThanOrEqual(CHUNK_SIZE);
      offset = end;
    }
    expect(offset).toBe(totalSizeBytes);
  });

  it("a file smaller than one chunk completes in a single chunk", () => {
    const totalSizeBytes = 500_000;
    expect(nextChunkEnd(0, totalSizeBytes, CHUNK_SIZE)).toBe(totalSizeBytes);
  });

  it("a file exactly one chunk in size completes in a single chunk", () => {
    expect(nextChunkEnd(0, CHUNK_SIZE, CHUNK_SIZE)).toBe(CHUNK_SIZE);
  });
});
