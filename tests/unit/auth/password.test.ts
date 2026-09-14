import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPassword } from "@/lib/auth/password";

describe("verifyPassword", () => {
  const hash = bcrypt.hashSync("correct-horse-battery-staple", 10);

  it("accepts the correct plaintext password", async () => {
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects an empty password", async () => {
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("rejects when no hash is configured", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});
