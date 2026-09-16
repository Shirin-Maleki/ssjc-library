import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Admin-level structural/destructive change history (docs/DATA_MODEL.md §11),
 * deliberately narrow — not event sourcing. `actorLabel` is a self-reported free-text
 * label ("teacher"/"admin"), never a verified identity, per docs/DECISIONS.md's "no
 * individual accounts" decision: there is nothing more precise to record.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_entity_idx").on(table.entityType, table.entityId)]
);

/** Centralized configurable thresholds/settings (docs/DATA_MODEL.md §11) — e.g. the
 * display-cover fallback order (§5), future ranking weights, confidence-routing
 * thresholds. `key` is the natural primary key; `value` is intentionally `jsonb` since
 * different settings have different shapes. */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Basic brute-force throttling (docs/DATA_MODEL.md §11; referenced in
 * docs/SECURITY.md as the Phase 4 replacement for Phase 1's in-memory rate limiter).
 * The table exists as approved schema in this phase; wiring `src/lib/auth/rateLimit.ts`
 * to persist here (rather than in-memory) is intentionally deferred — see
 * docs/DECISIONS.md — to avoid Phase 4 scope creep into an auth redesign the brief
 * explicitly warns against. `succeeded` records the outcome so a rolling window can
 * distinguish failed attempts (the only ones that count toward the throttle) from
 * successful ones.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    role: text("role").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("login_attempts_identifier_role_created_idx").on(table.identifier, table.role, table.createdAt)]
);
