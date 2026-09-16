import { describe, expect, it } from "vitest";
import { getLanguageName, isLanguageCode, languageCodeSchema } from "@/lib/catalog/languages";

/**
 * Proves the centralized ISO 639-1 registry (docs/DATA_MODEL.md §3, Phase 4 correction
 * pass) genuinely covers the standard list — not just the six languages the
 * development fixture catalog happens to use — without a database `languages` table.
 */
describe("language registry", () => {
  it("recognizes the six original fixture languages", () => {
    for (const code of ["en", "sv", "no", "da", "es", "fr"]) {
      expect(isLanguageCode(code)).toBe(true);
    }
  });

  it("recognizes a real ISO 639-1 code outside the original six fixture languages", () => {
    expect(isLanguageCode("de")).toBe(true);
    expect(getLanguageName("de")).toBe("German");
  });

  it("rejects a code that isn't a real ISO 639-1 language", () => {
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode("english")).toBe(false);
    expect(isLanguageCode("")).toBe(false);
  });

  it("languageCodeSchema (Zod) validates the same way at an application boundary", () => {
    expect(languageCodeSchema.safeParse("de").success).toBe(true);
    expect(languageCodeSchema.safeParse("ja").success).toBe(true);
    expect(languageCodeSchema.safeParse("not-a-code").success).toBe(false);
  });

  it("getLanguageName falls back to the raw code for an unrecognized value rather than throwing", () => {
    // @ts-expect-error — deliberately passing an unvalidated value to exercise the
    // defensive fallback, the same way a stale/foreign DB value would arrive.
    expect(getLanguageName("zz-not-real")).toBe("zz-not-real");
  });
});
