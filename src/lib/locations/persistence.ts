import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditLog, bookCopies, libraryLocations } from "@/db/schema";
import { generateUniqueCategorySlug } from "@/lib/admin/categorySlug";
import { isValidId } from "@/lib/admin/validation";

/**
 * Physical-copy location administration + the Move/Return workflow's actual
 * copy-mutation logic (Phase 9 addendum — physical copy locations). Mirrors
 * `src/lib/admin/persistence.ts`'s own conventions exactly: a dedicated module
 * of plain functions, each one real transaction/atomic-update plus an
 * `audit_log` row, never inline logic in a Server Action.
 *
 * BOOK ≠ COPY, CATEGORY ≠ LOCATION (see `docs/DATA_MODEL.md`'s Phase 9 addendum
 * entry): everything here operates on `book_copies` rows, never on `books`
 * directly — a book's physical category is a single, human-controlled,
 * rarely-changing shelving decision (`src/lib/admin/persistence.ts`'s category
 * functions); a copy's current location is per-copy, can change often, and is
 * intentionally a completely separate concept.
 */

const ADMIN_ACTOR = "admin";

// ---------------------------------------------------------------------------
// Location administration (§8 of the addendum) — small, admin-maintainable,
// never an enterprise inventory dashboard.
// ---------------------------------------------------------------------------

export type LocationType = "corridor" | "classroom" | "other";

export interface CreateLocationInput {
  displayName: string;
  locationType?: LocationType;
}

export type CreateLocationResult = { ok: true; id: string; slug: string } | { ok: false; error: "invalid_name"; message: string };

/** `slug` is generated once, here, from the initial name — permanently stable
 * afterward, exactly like `physical_categories` (§1: "Locations should have
 * stable identity so a classroom can be renamed without breaking
 * references"). Reuses the same slug generator physical categories already
 * use; the logic ("lowercase, hyphenate, dedupe against existing slugs") is
 * completely generic, not category-specific, despite the module's name. */
export async function createLocation(db: Database, input: CreateLocationInput): Promise<CreateLocationResult> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "invalid_name", message: "A location name is required." };

  return db.transaction(async (tx) => {
    const existingSlugs = await tx.select({ slug: libraryLocations.slug }).from(libraryLocations);
    const slug = generateUniqueCategorySlug(displayName, new Set(existingSlugs.map((r) => r.slug)));

    const [row] = await tx
      .insert(libraryLocations)
      .values({ slug, displayName, locationType: input.locationType ?? "other" })
      .returning({ id: libraryLocations.id, slug: libraryLocations.slug });

    await tx.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: "location_created", entityType: "library_location", entityId: row.id, detail: { displayName, slug: row.slug } });
    return { ok: true, id: row.id, slug: row.slug };
  });
}

export interface UpdateLocationInput {
  locationId: string;
  /** Presence-based — omit to leave alone, matching the category admin
   * functions' own patch philosophy. */
  displayName?: string;
  locationType?: LocationType;
}

export type UpdateLocationResult = { ok: true } | { ok: false; error: "not_found" | "invalid_name"; message: string };

/** Renaming NEVER touches `id` or `slug` — only `display_name`/`location_type`
 * are ever written here, exactly like `updateCategory`'s own rule. */
export async function updateLocation(db: Database, input: UpdateLocationInput): Promise<UpdateLocationResult> {
  if (!isValidId(input.locationId)) return { ok: false, error: "not_found", message: "This location could not be found." };
  if (input.displayName !== undefined && !input.displayName.trim()) return { ok: false, error: "invalid_name", message: "A location name is required." };

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(libraryLocations).where(eq(libraryLocations.id, input.locationId)).limit(1);
    if (!existing) return { ok: false as const, error: "not_found" as const, message: "This location could not be found." };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.displayName !== undefined) update.displayName = input.displayName.trim();
    if (input.locationType !== undefined) update.locationType = input.locationType;

    await tx.update(libraryLocations).set(update).where(eq(libraryLocations.id, input.locationId));
    await tx.insert(auditLog).values({
      actorLabel: ADMIN_ACTOR,
      action: "location_renamed",
      entityType: "library_location",
      entityId: input.locationId,
      detail: { previousName: existing.displayName, newName: input.displayName?.trim() ?? existing.displayName },
    });
    return { ok: true as const };
  });
}

export type SetLocationActiveResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "blocked_referenced"; message: string; referencingCopyCount?: number };

/**
 * Safe activation/deactivation (§8: "Prevent assigning new copies to inactive
 * locations. Do not allow deactivation in a way that leaves current copies
 * pointing to an invalid/unusable state without a deliberate resolution.") —
 * a location may never be deactivated while any copy still currently sits
 * there; those copies must be moved first. Activation has no such
 * restriction. Mirrors `setCategoryActive`'s identical shape.
 */
export async function setLocationActive(db: Database, locationId: string, isActive: boolean): Promise<SetLocationActiveResult> {
  if (!isValidId(locationId)) return { ok: false, error: "not_found", message: "This location could not be found." };

  const [existing] = await db.select({ id: libraryLocations.id }).from(libraryLocations).where(eq(libraryLocations.id, locationId)).limit(1);
  if (!existing) return { ok: false, error: "not_found", message: "This location could not be found." };

  if (!isActive) {
    const referencing = await db.select({ id: bookCopies.id }).from(bookCopies).where(eq(bookCopies.currentLocationId, locationId));
    if (referencing.length > 0) {
      return {
        ok: false,
        error: "blocked_referenced",
        message: `${referencing.length} cop${referencing.length === 1 ? "y is" : "ies are"} currently recorded at this location. Move ${referencing.length === 1 ? "it" : "them"} before deactivating it.`,
        referencingCopyCount: referencing.length,
      };
    }
  }

  await db.update(libraryLocations).set({ isActive, updatedAt: new Date() }).where(eq(libraryLocations.id, locationId));
  await db.insert(auditLog).values({ actorLabel: ADMIN_ACTOR, action: isActive ? "location_activated" : "location_deactivated", entityType: "library_location", entityId: locationId, detail: {} });
  return { ok: true };
}

export interface LocationWithUsage {
  id: string;
  slug: string;
  displayName: string;
  locationType: LocationType;
  isActive: boolean;
  /** A real, live `count(*)` of copies currently recorded here — never an
   * estimate — so the admin list can disable/explain the deactivate control
   * before an admin even attempts it, mirroring `CategoryHealthRow`'s own
   * `canDeactivate` convention (`categoryHealth.ts`). */
  currentCopyCount: number;
}

/** Real, database-measured location usage (§8: "inspect basic usage/counts")
 * — deliberately not an enterprise inventory dashboard, just enough for an
 * admin to safely rename/deactivate. */
export async function listLocationsWithUsage(db: Database): Promise<LocationWithUsage[]> {
  const locations = await db.select().from(libraryLocations);
  if (locations.length === 0) return [];

  const counts = await db
    .select({ locationId: bookCopies.currentLocationId, count: sql<number>`count(*)::int` })
    .from(bookCopies)
    .where(sql`${bookCopies.currentLocationId} is not null`)
    .groupBy(bookCopies.currentLocationId);
  const countById = new Map(counts.filter((c) => c.locationId).map((c) => [c.locationId as string, c.count]));

  return locations
    .map((location) => ({
      id: location.id,
      slug: location.slug,
      displayName: location.displayName,
      locationType: location.locationType,
      isActive: location.isActive,
      currentCopyCount: countById.get(location.id) ?? 0,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// Copy-location reads + the Move/Return workflow's mutation (§2/§3/§9 of the
// addendum).
// ---------------------------------------------------------------------------

export interface CopyLocationCount {
  /** `null` represents the honest "no location has been recorded for this
   * copy yet" bucket (§1) — never guessed, and never excluded from the
   * summary a teacher sees, since a real pre-existing copy may genuinely have
   * no location on file. */
  locationId: string | null;
  label: string;
  count: number;
}

const UNRECORDED_LOCATION_LABEL = "Location not recorded";

/**
 * "Corridor 218 (2), Blue Room (1)" — the exact data both the Move/Return
 * workflow's source-location picker and the Google Sheet's Location column
 * need (§2/§5). Deterministic order: named locations alphabetically by label,
 * the unrecorded bucket always last (never first — a real location is always
 * more useful information than "unknown").
 */
export async function getCopyLocationSummary(db: Database, bookId: string): Promise<CopyLocationCount[]> {
  const rows = await db
    .select({ locationId: bookCopies.currentLocationId, displayName: libraryLocations.displayName })
    .from(bookCopies)
    .leftJoin(libraryLocations, eq(bookCopies.currentLocationId, libraryLocations.id))
    .where(eq(bookCopies.bookId, bookId));

  const counts = new Map<string, CopyLocationCount>();
  for (const row of rows) {
    const key = row.locationId ?? "__unrecorded__";
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { locationId: row.locationId, label: row.locationId ? (row.displayName ?? "Unknown location") : UNRECORDED_LOCATION_LABEL, count: 1 });
    }
  }

  return [...counts.values()].sort((a, b) => {
    if (a.locationId === null && b.locationId === null) return 0;
    if (a.locationId === null) return 1;
    if (b.locationId === null) return -1;
    return a.label.localeCompare(b.label);
  });
}

/** Batch form of `getCopyLocationSummary` for the Google Sheets sync (§5) —
 * one query for every visible book's copies, not one query per book. */
export async function getCopyLocationSummaryForBooks(db: Database, bookIds: string[]): Promise<Map<string, CopyLocationCount[]>> {
  const result = new Map<string, CopyLocationCount[]>();
  if (bookIds.length === 0) return result;

  const rows = await db
    .select({ bookId: bookCopies.bookId, locationId: bookCopies.currentLocationId, displayName: libraryLocations.displayName })
    .from(bookCopies)
    .leftJoin(libraryLocations, eq(bookCopies.currentLocationId, libraryLocations.id));

  const perBook = new Map<string, Map<string, CopyLocationCount>>();
  for (const row of rows) {
    let counts = perBook.get(row.bookId);
    if (!counts) {
      counts = new Map();
      perBook.set(row.bookId, counts);
    }
    const key = row.locationId ?? "__unrecorded__";
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { locationId: row.locationId, label: row.locationId ? (row.displayName ?? "Unknown location") : UNRECORDED_LOCATION_LABEL, count: 1 });
    }
  }

  for (const bookId of bookIds) {
    const counts = perBook.get(bookId);
    const list = counts ? [...counts.values()] : [];
    list.sort((a, b) => {
      if (a.locationId === null && b.locationId === null) return 0;
      if (a.locationId === null) return 1;
      if (b.locationId === null) return -1;
      return a.label.localeCompare(b.label);
    });
    result.set(bookId, list);
  }
  return result;
}

export interface MoveCopyInput {
  bookId: string;
  /** `null` means "the copy currently has no location recorded" — the same
   * honest bucket `getCopyLocationSummary` returns, never a real location's
   * id repurposed to mean "unknown." */
  fromLocationId: string | null;
  toLocationId: string;
  actorLabel: string;
}

export type MoveCopyResult =
  | { ok: true; copyId: string; fromLabel: string; toLabel: string }
  | { ok: false; error: "invalid_destination" | "no_copy_available" | "same_location"; message: string };

const MAX_MOVE_CLAIM_ATTEMPTS = 3;

/**
 * Atomically moves exactly ONE physical copy from `fromLocationId` to
 * `toLocationId` (§2: "The operation should atomically move exactly ONE
 * copy... Never infer an exact physical-copy identity from a cover photo when
 * identical copies exist" — any one copy currently at the source is
 * interchangeable, so which specific `book_copies` row gets updated is never
 * exposed to or chosen by the teacher).
 *
 * Reuses the exact select-a-candidate-then-conditional-UPDATE pattern already
 * established for ingestion-item claiming (`src/lib/bulkImport/claim.ts`,
 * itself reused from Phase 8's `approveReviewLater`/`resolveDuplicate`) —
 * never a first read followed by a blind write. A bounded retry loop (never
 * unbounded) picks a fresh candidate on each attempt: if two moves race for
 * the last copy at a location, the loser's conditional UPDATE affects zero
 * rows, and retrying finds no candidate left there rather than double-moving
 * anything (§2's "source location with quantity>1 decrements by one" — and,
 * just as importantly, a location with quantity exactly 1 never goes to -1
 * under concurrent requests).
 */
export async function moveCopy(db: Database, input: MoveCopyInput): Promise<MoveCopyResult> {
  if (!isValidId(input.bookId) || !isValidId(input.toLocationId)) {
    return { ok: false, error: "invalid_destination", message: "That destination location isn't valid." };
  }
  if (input.fromLocationId !== null && input.fromLocationId === input.toLocationId) {
    return { ok: false, error: "same_location", message: "That copy is already at this location." };
  }

  const [destination] = await db
    .select({ id: libraryLocations.id, displayName: libraryLocations.displayName, isActive: libraryLocations.isActive })
    .from(libraryLocations)
    .where(eq(libraryLocations.id, input.toLocationId))
    .limit(1);
  if (!destination || !destination.isActive) {
    return { ok: false, error: "invalid_destination", message: "That location isn't available to move a copy to." };
  }

  const fromLabel =
    input.fromLocationId === null
      ? UNRECORDED_LOCATION_LABEL
      : ((await db.select({ displayName: libraryLocations.displayName }).from(libraryLocations).where(eq(libraryLocations.id, input.fromLocationId)).limit(1))[0]?.displayName ?? "Unknown location");

  const sourceCondition = input.fromLocationId === null ? isNull(bookCopies.currentLocationId) : eq(bookCopies.currentLocationId, input.fromLocationId);

  for (let attempt = 0; attempt < MAX_MOVE_CLAIM_ATTEMPTS; attempt += 1) {
    const [candidate] = await db
      .select({ id: bookCopies.id })
      .from(bookCopies)
      .where(and(eq(bookCopies.bookId, input.bookId), sourceCondition))
      .limit(1);
    if (!candidate) {
      return { ok: false, error: "no_copy_available", message: "No copy of this book is currently recorded at that location." };
    }

    const updated = await db
      .update(bookCopies)
      .set({ currentLocationId: input.toLocationId })
      .where(and(eq(bookCopies.id, candidate.id), sourceCondition))
      .returning({ id: bookCopies.id });

    if (updated.length > 0) {
      await db.insert(auditLog).values({
        actorLabel: input.actorLabel,
        action: "book_copy_moved",
        entityType: "book_copy",
        entityId: candidate.id,
        detail: { bookId: input.bookId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, fromLabel, toLabel: destination.displayName },
      });
      return { ok: true, copyId: candidate.id, fromLabel, toLabel: destination.displayName };
    }
    // Lost the race for this exact candidate — loop and pick a fresh one.
  }

  return { ok: false, error: "no_copy_available", message: "That copy was already moved by someone else. Please try again." };
}
