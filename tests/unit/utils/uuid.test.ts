import { describe, expect, it } from "vitest";
import { isUuid, uuidSchema } from "@/lib/utils/uuid";

describe("isUuid", () => {
  it("accepts a real UUID, case-insensitively", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("F2CF8755-096F-48FA-BE6A-F8FD315BDF6D")).toBe(true);
  });

  it("rejects a malformed value rather than crashing", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-00000000000")).toBe(false); // one char short
  });
});

describe("uuidSchema", () => {
  it("mirrors isUuid at a Zod validation boundary", () => {
    expect(uuidSchema.safeParse("00000000-0000-0000-0000-000000000000").success).toBe(true);
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
