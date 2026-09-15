import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

const SCRIPT_PATH = path.resolve(__dirname, "../../../scripts/hash-password.mjs");

/**
 * A minimal reimplementation of the variable-expansion behavior Next.js's .env loader
 * applies (dotenv-expand): any "$word" (word = letters/digits/underscore) is replaced
 * by the named environment variable's value, or "" if undefined. This is exactly what
 * silently corrupted an unescaped bcrypt hash in real local testing — see
 * docs/SECURITY.md and the commit that fixed scripts/hash-password.mjs. Reimplemented
 * here (rather than importing Next's internal, unstable module path) so this test
 * documents and guards against the exact real failure mode, not a hypothetical one.
 */
function simulateDotenvExpand(value: string, env: Record<string, string> = {}): string {
  return value.replace(/\\?\$\{?(\w+)\}?/g, (match, name: string) => {
    if (match.startsWith("\\")) return match.slice(1); // escaped — literal, unexpanded
    return env[name] ?? "";
  });
}

describe("scripts/hash-password.mjs", () => {
  it("prints a hash with every literal $ escaped as \\$", () => {
    const output = execFileSync("node", [SCRIPT_PATH, "correct-horse-battery-staple"], {
      encoding: "utf8",
    });
    const [hashLine] = output.split("\n");
    expect(hashLine).toMatch(/^\\\$2[aby]\\\$\d+\\\$/);
  });

  it("produces a hash that still verifies the original password once unescaped", () => {
    const output = execFileSync("node", [SCRIPT_PATH, "correct-horse-battery-staple"], {
      encoding: "utf8",
    });
    const [hashLine] = output.split("\n");
    const unescaped = hashLine.replaceAll("\\$", "$");
    expect(bcrypt.compareSync("correct-horse-battery-staple", unescaped)).toBe(true);
  });

  it("regression: the escaped hash survives dotenv-style $-expansion unchanged, unlike a raw one", () => {
    const rawHash = bcrypt.hashSync("correct-horse-battery-staple", 10);
    const escapedHash = rawHash.replaceAll("$", "\\$");

    // This is the real bug: a raw bcrypt hash pasted directly into .env.local gets
    // silently mangled, because "$2b", "$12", and the salt segment all look like
    // variable references to expand.
    const corrupted = simulateDotenvExpand(rawHash);
    expect(corrupted).not.toBe(rawHash);
    expect(bcrypt.compareSync("correct-horse-battery-staple", corrupted)).toBe(false);

    // The escaped form (what the script actually outputs) survives intact.
    const survived = simulateDotenvExpand(escapedHash);
    expect(survived).toBe(rawHash);
    expect(bcrypt.compareSync("correct-horse-battery-staple", survived)).toBe(true);
  });
});
