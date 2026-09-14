import { describe, expect, it } from "vitest";
import { passwordFormSchema } from "@/lib/validation/auth";

describe("passwordFormSchema", () => {
  it("accepts a non-empty password", () => {
    expect(passwordFormSchema.safeParse({ password: "hello" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(passwordFormSchema.safeParse({ password: "" }).success).toBe(false);
  });

  it("rejects a missing password field", () => {
    expect(passwordFormSchema.safeParse({}).success).toBe(false);
  });
});
