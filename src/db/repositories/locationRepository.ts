import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { libraryLocations } from "../schema";

export interface LibraryLocationOption {
  id: string;
  slug: string;
  displayName: string;
  locationType: "corridor" | "classroom" | "other";
}

/**
 * The database-managed library-location list (Phase 9 addendum — physical copy
 * locations) — mirrors `categoryRepository.ts`'s own shape and split between
 * "every location" (admin management, where an already-assigned inactive
 * location must still resolve to a real name) and "active only" (the Move/
 * Return workflow's destination picker, and the bulk importer's `--location`
 * validation — an inactive location must never be offered as somewhere a copy
 * can newly go).
 */
export class DrizzleLocationRepository {
  constructor(private readonly db: Database) {}

  async listLocations(): Promise<LibraryLocationOption[]> {
    const rows = await this.db
      .select({ id: libraryLocations.id, slug: libraryLocations.slug, displayName: libraryLocations.displayName, locationType: libraryLocations.locationType })
      .from(libraryLocations);
    return rows;
  }

  async listActiveLocations(): Promise<LibraryLocationOption[]> {
    const rows = await this.db
      .select({ id: libraryLocations.id, slug: libraryLocations.slug, displayName: libraryLocations.displayName, locationType: libraryLocations.locationType })
      .from(libraryLocations)
      .where(eq(libraryLocations.isActive, true));
    return rows;
  }
}
