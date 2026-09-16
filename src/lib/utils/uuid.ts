import { z } from "zod";

/**
 * Every primary key in the Phase 4 schema is a real Postgres `uuid` column
 * (`docs/DATA_MODEL.md`) — passing an arbitrary string straight into a Drizzle
 * `eq(table.id, value)` comparison against a `uuid` column throws a raw
 * "invalid input syntax for type uuid" database error for anything that isn't
 * actually UUID-shaped. Validating the shape first, at the boundary where an
 * external value (a URL param, a Server Action argument) enters the system, turns
 * that into an ordinary "not found" domain outcome instead of a database exception
 * reaching the user (Phase 4 correction pass).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export const uuidSchema = z.string().regex(UUID_PATTERN, { message: "Not a valid UUID." });
