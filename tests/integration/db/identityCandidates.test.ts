import { describe, expect, it, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { ingestionItems, ingestionJobs, bookIdentityCandidates } from "@/db/schema";
import { persistIdentityCandidates } from "@/lib/intake/identityCandidates";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("intake/identityCandidates (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const createdJobIds: string[] = [];

  afterEach(async () => {
    for (const id of createdJobIds.splice(0)) {
      await db.delete(ingestionJobs).where(eq(ingestionJobs.id, id)); // cascades ingestion_items -> book_identity_candidates
    }
  });
  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function makeIngestionItem(): Promise<string> {
    const [job] = await db
      .insert(ingestionJobs)
      .values({ jobType: "single_add", source: "teacher_capture", status: "running", totalItems: 1 })
      .returning({ id: ingestionJobs.id });
    createdJobIds.push(job.id);
    const [item] = await db
      .insert(ingestionItems)
      .values({ jobId: job.id, driveFileId: `test-drive-file-${crypto.randomUUID()}`, status: "processing" })
      .returning({ id: ingestionItems.id });
    return item.id;
  }

  it("persists every candidate considered, marking exactly the selected one", async () => {
    const ingestionItemId = await makeIngestionItem();
    await persistIdentityCandidates(db, ingestionItemId, [
      { candidate: { provider: "open_library", providerIdentifier: "ol-1", title: "The Gruffalo" }, matchScore: 95, wasSelected: true },
      { candidate: { provider: "open_library", providerIdentifier: "ol-2", title: "A Different Gruffalo Edition" }, matchScore: 20, wasSelected: false },
    ]);

    const rows = await db.select().from(bookIdentityCandidates).where(eq(bookIdentityCandidates.ingestionItemId, ingestionItemId));
    expect(rows.length).toBe(2);
    const selected = rows.find((r) => r.providerIdentifier === "ol-1")!;
    expect(selected.wasSelected).toBe(true);
    expect(selected.provider).toBe("open_library");
    expect(Number(selected.matchConfidence)).toBeCloseTo(0.95, 2);
    expect((selected.rawResponse as { title?: string }).title).toBe("The Gruffalo");

    const notSelected = rows.find((r) => r.providerIdentifier === "ol-2")!;
    expect(notSelected.wasSelected).toBe(false);
  });

  it("clamps an out-of-range raw score (a stacked-signal reconciliation score can exceed 100) to the column's real numeric(3,2) limit", async () => {
    const ingestionItemId = await makeIngestionItem();
    await persistIdentityCandidates(db, ingestionItemId, [
      { candidate: { provider: "google_books", providerIdentifier: "gb-1", title: "X" }, matchScore: 195, wasSelected: true },
    ]);
    const [row] = await db.select().from(bookIdentityCandidates).where(eq(bookIdentityCandidates.ingestionItemId, ingestionItemId));
    expect(Number(row.matchConfidence)).toBeLessThanOrEqual(1);
  });

  it("a retry replaces the previous candidate set rather than appending duplicates", async () => {
    const ingestionItemId = await makeIngestionItem();
    await persistIdentityCandidates(db, ingestionItemId, [
      { candidate: { provider: "open_library", providerIdentifier: "ol-1", title: "First attempt" }, matchScore: 50, wasSelected: true },
    ]);
    await persistIdentityCandidates(db, ingestionItemId, [
      { candidate: { provider: "open_library", providerIdentifier: "ol-2", title: "Retry attempt" }, matchScore: 80, wasSelected: true },
    ]);

    const rows = await db.select().from(bookIdentityCandidates).where(eq(bookIdentityCandidates.ingestionItemId, ingestionItemId));
    expect(rows.length).toBe(1);
    expect(rows[0].providerIdentifier).toBe("ol-2");
  });

  it("an empty candidate list clears any previous rows without inserting new ones", async () => {
    const ingestionItemId = await makeIngestionItem();
    await persistIdentityCandidates(db, ingestionItemId, [
      { candidate: { provider: "open_library", providerIdentifier: "ol-1", title: "X" }, matchScore: 50, wasSelected: true },
    ]);
    await persistIdentityCandidates(db, ingestionItemId, []);

    const rows = await db.select().from(bookIdentityCandidates).where(eq(bookIdentityCandidates.ingestionItemId, ingestionItemId));
    expect(rows).toEqual([]);
  });
});
