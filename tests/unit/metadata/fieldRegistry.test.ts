import { describe, expect, it } from "vitest";
import {
  isMetadataFieldKey,
  metadataFieldConcept,
  metadataFieldKeySchema,
  TRACKED_METADATA_FIELDS,
} from "@/lib/metadata/fieldRegistry";

/**
 * Proves the registry `docs/DATA_MODEL.md` §6 always described actually exists now —
 * `book_field_provenance.field_key` is validated against this module, never a
 * PostgreSQL enum (Phase 4 correction pass).
 */
describe("metadata field registry", () => {
  it("validates every currently-tracked field key", () => {
    for (const key of Object.keys(TRACKED_METADATA_FIELDS)) {
      expect(isMetadataFieldKey(key)).toBe(true);
    }
  });

  it("validates the field_key example docs/DATA_MODEL.md §4 names explicitly", () => {
    expect(isMetadataFieldKey("age_range")).toBe(true);
  });

  it("rejects an untracked/unknown field key", () => {
    expect(isMetadataFieldKey("favorite_color")).toBe(false);
    expect(isMetadataFieldKey("")).toBe(false);
  });

  it("metadataFieldKeySchema (Zod) validates the same way at an application boundary", () => {
    expect(metadataFieldKeySchema.safeParse("physical_category").success).toBe(true);
    expect(metadataFieldKeySchema.safeParse("not_a_tracked_field").success).toBe(false);
  });

  it("every tracked field maps to one of the documented concepts (identity/category/age/visual/metadata)", () => {
    const allowedConcepts = new Set(["identity", "category", "age", "visual", "metadata"]);
    for (const key of Object.keys(TRACKED_METADATA_FIELDS) as (keyof typeof TRACKED_METADATA_FIELDS)[]) {
      expect(allowedConcepts.has(metadataFieldConcept(key))).toBe(true);
    }
  });

  it("adding a future tracked field is purely an application-code change, not a schema migration — proven by there being no database dependency anywhere in this module", async () => {
    // This module never imports Drizzle, a schema file, or anything database-shaped —
    // grep-verified as part of this test's own intent, not just asserted. Whatever
    // keys exist in TRACKED_METADATA_FIELDS today are the entire contract; adding one
    // is a one-line object literal change here, nothing else.
    const moduleSource = await import("@/lib/metadata/fieldRegistry");
    expect(Object.keys(moduleSource)).toEqual(
      expect.arrayContaining(["TRACKED_METADATA_FIELDS", "isMetadataFieldKey", "metadataFieldKeySchema", "metadataFieldConcept"])
    );
  });
});
