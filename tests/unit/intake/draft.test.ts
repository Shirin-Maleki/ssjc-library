import { describe, expect, it } from "vitest";
import { createInitialDraft, parseIntakeDraft, readIntakeDraft, INTAKE_DRAFT_SCHEMA_VERSION } from "@/lib/intake/draft";

const DRIVE_SOURCE = { fileId: "drive-file-1", filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 12345, checksum: "abc123" };

describe("intake/draft — createInitialDraft", () => {
  it("produces a draft with the current schema version and 'uploaded' stage", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    expect(draft.schemaVersion).toBe(INTAKE_DRAFT_SCHEMA_VERSION);
    expect(draft.pipelineStage).toBe("uploaded");
    expect(draft.driveSource).toEqual(DRIVE_SOURCE);
  });

  it("never contains a secret, image byte, or session URI field — only the durable Drive file id and safe metadata", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toMatch(/sessionUri|session_uri|accessToken|refreshToken|clientSecret/i);
  });

  it("round-trips through parseIntakeDraft without alteration", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    const parsed = parseIntakeDraft(draft);
    expect(parsed).toEqual(draft);
  });
});

describe("intake/draft — readIntakeDraft", () => {
  it("returns undefined for a null column value rather than throwing", () => {
    expect(readIntakeDraft(null)).toBeUndefined();
    expect(readIntakeDraft(undefined)).toBeUndefined();
  });

  it("returns undefined for a value that doesn't match the current schema, rather than throwing", () => {
    expect(readIntakeDraft({ garbage: true })).toBeUndefined();
    expect(readIntakeDraft("not even an object")).toBeUndefined();
  });

  it("returns undefined for a stale schemaVersion (forces a fresh intake rather than misreading old shape)", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    expect(readIntakeDraft({ ...draft, schemaVersion: 999 })).toBeUndefined();
  });

  it("successfully reads back a valid, previously-written draft", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    const roundTripped = JSON.parse(JSON.stringify(draft));
    expect(readIntakeDraft(roundTripped)).toEqual(draft);
  });
});

describe("intake/draft — parseIntakeDraft", () => {
  it("throws on a genuinely invalid draft (defense before persistence)", () => {
    expect(() => parseIntakeDraft({ not: "a draft" })).toThrow();
  });

  it("accepts a draft with real evidence/candidates/duplicate state populated", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    draft.pipelineStage = "duplicate_checked";
    draft.duplicateOutcome = "ambiguous_similar_title";
    draft.duplicateCandidateBookIds = ["11111111-1111-1111-1111-111111111111"];
    expect(() => parseIntakeDraft(draft)).not.toThrow();
  });

  it("strips any field outside the limited teacher-facing correction surface, never persisting it", () => {
    const draft = createInitialDraft(DRIVE_SOURCE);
    const withExtraField = { ...draft, teacherEdits: { title: "Corrected Title", rawConfidence: 0.9, providerIdentifier: "should-not-persist" } };
    const parsed = parseIntakeDraft(withExtraField);
    expect(parsed.teacherEdits).toEqual({ title: "Corrected Title" });
    expect(parsed.teacherEdits).not.toHaveProperty("rawConfidence");
    expect(parsed.teacherEdits).not.toHaveProperty("providerIdentifier");
  });
});
