import { beforeEach, describe, expect, it } from "vitest";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "@/lib/auth/rateLimit";

describe("rate limiting", () => {
  const key = "test:127.0.0.1";

  beforeEach(() => {
    resetAttempts(key);
  });

  it("allows attempts under the threshold", () => {
    for (let i = 0; i < 7; i += 1) {
      recordFailedAttempt(key);
    }
    expect(isRateLimited(key)).toBe(false);
  });

  it("blocks once the threshold is reached", () => {
    for (let i = 0; i < 8; i += 1) {
      recordFailedAttempt(key);
    }
    expect(isRateLimited(key)).toBe(true);
  });

  it("resets cleanly after a successful attempt", () => {
    for (let i = 0; i < 8; i += 1) {
      recordFailedAttempt(key);
    }
    expect(isRateLimited(key)).toBe(true);
    resetAttempts(key);
    expect(isRateLimited(key)).toBe(false);
  });
});
