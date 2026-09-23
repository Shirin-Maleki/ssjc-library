import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { books, bookCopies, libraryLocations } from "@/db/schema";
import { createLocation, updateLocation, setLocationActive, getCopyLocationSummary, moveCopy } from "@/lib/locations/persistence";
import { requireTestDatabaseUrl, createTestDb } from "./testDb";

const hasTestDb = (() => {
  try {
    requireTestDatabaseUrl();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTestDb)("Phase 9 addendum — physical copy locations (against a real Postgres database)", () => {
  const { db, client } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const createdBookIds: string[] = [];
  const createdLocationIds: string[] = [];

  afterEach(async () => {
    if (createdBookIds.length > 0) {
      await db.delete(bookCopies).where(inArray(bookCopies.bookId, createdBookIds));
      await db.delete(books).where(inArray(books.id, createdBookIds));
      createdBookIds.length = 0;
    }
    if (createdLocationIds.length > 0) {
      await db.delete(libraryLocations).where(inArray(libraryLocations.id, createdLocationIds));
      createdLocationIds.length = 0;
    }
  });

  afterAll(async () => {
    if (hasTestDb) await client.end();
  });

  async function makeBook(title: string) {
    const [row] = await db
      .insert(books)
      .values({ title, normalizedTitle: title.toLowerCase(), sortTitle: title, languageCode: "en" })
      .returning({ id: books.id });
    createdBookIds.push(row.id);
    return row.id;
  }

  async function makeLocation(displayName: string, overrides: Partial<typeof libraryLocations.$inferInsert> = {}) {
    const [row] = await db
      .insert(libraryLocations)
      .values({ slug: `loc-test-${displayName.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`, displayName, ...overrides })
      .returning({ id: libraryLocations.id });
    createdLocationIds.push(row.id);
    return row.id;
  }

  async function copyCountAtLocation(bookId: string, locationId: string | null) {
    const rows = await db.select({ currentLocationId: bookCopies.currentLocationId }).from(bookCopies).where(eq(bookCopies.bookId, bookId));
    return rows.filter((r) => r.currentLocationId === locationId).length;
  }

  // -------------------------------------------------------------------
  // getCopyLocationSummary — real read-side shapes (§11)
  // -------------------------------------------------------------------

  it("one book / one copy / one location", async () => {
    const l1 = await makeLocation("Solo Room");
    const bookId = await makeBook("One Copy Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: l1 });

    const summary = await getCopyLocationSummary(db, bookId);
    expect(summary).toEqual([{ locationId: l1, label: "Solo Room", count: 1 }]);
  });

  it("several copies in one location", async () => {
    const l1 = await makeLocation("Crowded Room");
    const bookId = await makeBook("Several Copies Book");
    await db.insert(bookCopies).values([{ bookId, currentLocationId: l1 }, { bookId, currentLocationId: l1 }, { bookId, currentLocationId: l1 }]);

    const summary = await getCopyLocationSummary(db, bookId);
    expect(summary).toEqual([{ locationId: l1, label: "Crowded Room", count: 3 }]);
  });

  it("copies distributed across several locations, plus a genuinely unrecorded bucket, in deterministic order", async () => {
    const l1 = await makeLocation("Zebra Room");
    const l2 = await makeLocation("Alpha Room");
    const bookId = await makeBook("Spread Copies Book");
    await db.insert(bookCopies).values([{ bookId, currentLocationId: l1 }, { bookId, currentLocationId: l2 }, { bookId, currentLocationId: null }]);

    const summary = await getCopyLocationSummary(db, bookId);
    // Alphabetical by label ("Alpha" before "Zebra"), unrecorded bucket last —
    // never first, and never silently dropped.
    expect(summary).toEqual([
      { locationId: l2, label: "Alpha Room", count: 1 },
      { locationId: l1, label: "Zebra Room", count: 1 },
      { locationId: null, label: "Location not recorded", count: 1 },
    ]);
  });

  // -------------------------------------------------------------------
  // moveCopy — the actual mutation (§2/§3/§9)
  // -------------------------------------------------------------------

  it("moves exactly one copy between locations; source (qty>1) decrements by one, destination increments by one", async () => {
    const from = await makeLocation("Move Source Room");
    const to = await makeLocation("Move Destination Room");
    const bookId = await makeBook("Move Test Book");
    await db.insert(bookCopies).values([{ bookId, currentLocationId: from }, { bookId, currentLocationId: from }]);

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: to, actorLabel: "test" });
    expect(result.ok).toBe(true);

    expect(await copyCountAtLocation(bookId, from)).toBe(1);
    expect(await copyCountAtLocation(bookId, to)).toBe(1);
  });

  it("moves a copy out of the genuinely-unrecorded bucket (fromLocationId: null) just as validly as a named location", async () => {
    const to = await makeLocation("Newly Recorded Room");
    const bookId = await makeBook("Unrecorded Move Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: null });

    const result = await moveCopy(db, { bookId, fromLocationId: null, toLocationId: to, actorLabel: "test" });
    expect(result.ok).toBe(true);
    expect(await copyCountAtLocation(bookId, null)).toBe(0);
    expect(await copyCountAtLocation(bookId, to)).toBe(1);
  });

  it("records a truthful audit_log entry for a move", async () => {
    const { auditLog } = await import("@/db/schema");
    const from = await makeLocation("Audit Source Room");
    const to = await makeLocation("Audit Destination Room");
    const bookId = await makeBook("Audit Move Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from });

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: to, actorLabel: "teacher" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, result.copyId)).limit(1);
    expect(entry?.action).toBe("book_copy_moved");
    expect(entry?.entityType).toBe("book_copy");
    expect(entry?.actorLabel).toBe("teacher");
    const detail = entry?.detail as { bookId: string; fromLocationId: string | null; toLocationId: string };
    expect(detail.bookId).toBe(bookId);
    expect(detail.fromLocationId).toBe(from);
    expect(detail.toLocationId).toBe(to);
  });

  it("rejects a nonexistent destination location", async () => {
    const from = await makeLocation("Valid Source Room");
    const bookId = await makeBook("Invalid Destination Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from });

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: "00000000-0000-0000-0000-000000000000", actorLabel: "test" });
    expect(result).toEqual({ ok: false, error: "invalid_destination", message: expect.any(String) });
    expect(await copyCountAtLocation(bookId, from)).toBe(1); // untouched
  });

  it("rejects an inactive destination location", async () => {
    const from = await makeLocation("Active Source Room");
    const inactiveTo = await makeLocation("Inactive Destination Room", { isActive: false });
    const bookId = await makeBook("Inactive Destination Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from });

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: inactiveTo, actorLabel: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_destination");
    expect(await copyCountAtLocation(bookId, from)).toBe(1); // untouched
  });

  it("rejects moving to the same location a copy is already at", async () => {
    const l1 = await makeLocation("Same Place Room");
    const bookId = await makeBook("Same Location Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: l1 });

    const result = await moveCopy(db, { bookId, fromLocationId: l1, toLocationId: l1, actorLabel: "test" });
    expect(result).toEqual({ ok: false, error: "same_location", message: expect.any(String) });
  });

  it("fails honestly (no_copy_available) when no copy exists at the claimed source location", async () => {
    const from = await makeLocation("Empty Source Room");
    const to = await makeLocation("Some Destination Room");
    const bookId = await makeBook("No Copy Here Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: null }); // the one real copy is NOT at `from`

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: to, actorLabel: "test" });
    expect(result).toEqual({ ok: false, error: "no_copy_available", message: expect.any(String) });
  });

  it("never creates or destroys a physical copy during a move", async () => {
    const from = await makeLocation("Count Preserving Source");
    const to = await makeLocation("Count Preserving Destination");
    const bookId = await makeBook("Copy Count Preserved Book");
    await db.insert(bookCopies).values([{ bookId, currentLocationId: from }, { bookId, currentLocationId: from }]);

    await moveCopy(db, { bookId, fromLocationId: from, toLocationId: to, actorLabel: "test" });

    const rows = await db.select().from(bookCopies).where(eq(bookCopies.bookId, bookId));
    expect(rows).toHaveLength(2);
  });

  it("never creates a bibliographic book record during a move", async () => {
    const from = await makeLocation("No New Book Source");
    const to = await makeLocation("No New Book Destination");
    const bookId = await makeBook("No New Book Test Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from });

    const beforeCount = (await db.select({ id: books.id }).from(books)).length;

    await moveCopy(db, { bookId, fromLocationId: from, toLocationId: to, actorLabel: "test" });

    const afterCount = (await db.select({ id: books.id }).from(books)).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("concurrent moves for the last copy at a location: exactly one succeeds, the other fails honestly rather than corrupting state", async () => {
    const from = await makeLocation("Contested Source Room");
    const toA = await makeLocation("Contested Destination A");
    const toB = await makeLocation("Contested Destination B");
    const bookId = await makeBook("Concurrent Move Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from }); // exactly ONE copy

    const [resultA, resultB] = await Promise.all([
      moveCopy(db, { bookId, fromLocationId: from, toLocationId: toA, actorLabel: "test-a" }),
      moveCopy(db, { bookId, fromLocationId: from, toLocationId: toB, actorLabel: "test-b" }),
    ]);

    const succeeded = [resultA, resultB].filter((r) => r.ok);
    expect(succeeded).toHaveLength(1); // never both, never neither
    const rows = await db.select().from(bookCopies).where(eq(bookCopies.bookId, bookId));
    expect(rows).toHaveLength(1); // still exactly one physical copy — never duplicated
  });

  // -------------------------------------------------------------------
  // Location administration (§8)
  // -------------------------------------------------------------------

  it("createLocation generates a stable slug that a later rename never changes", async () => {
    const result = await createLocation(db, { displayName: "Rename Test Room" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdLocationIds.push(result.id);

    const renamed = await updateLocation(db, { locationId: result.id, displayName: "Completely Different Name" });
    expect(renamed.ok).toBe(true);

    const [row] = await db.select().from(libraryLocations).where(eq(libraryLocations.id, result.id)).limit(1);
    expect(row.slug).toBe(result.slug); // unchanged
    expect(row.displayName).toBe("Completely Different Name");
  });

  it("blocks deactivating a location that still has copies recorded there, and allows it once they're moved", async () => {
    const l1 = await makeLocation("Occupied Room");
    const l2 = await makeLocation("Elsewhere Room");
    const bookId = await makeBook("Deactivation Test Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: l1 });

    const blocked = await setLocationActive(db, l1, false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("blocked_referenced");

    await moveCopy(db, { bookId, fromLocationId: l1, toLocationId: l2, actorLabel: "test" });

    const allowed = await setLocationActive(db, l1, false);
    expect(allowed.ok).toBe(true);
  });

  it("prevents a new copy from being assigned to an inactive location (via moveCopy's own destination check)", async () => {
    const from = await makeLocation("Prevent Source Room");
    const inactive = await makeLocation("Prevent Destination Room", { isActive: false });
    const bookId = await makeBook("Prevent Assignment Book");
    await db.insert(bookCopies).values({ bookId, currentLocationId: from });

    const result = await moveCopy(db, { bookId, fromLocationId: from, toLocationId: inactive, actorLabel: "test" });
    expect(result.ok).toBe(false);
  });
});
