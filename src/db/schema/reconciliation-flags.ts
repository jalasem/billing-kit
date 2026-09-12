import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { providerEnum, reconciliationFlagKindEnum } from "./enums";

export const reconciliationFlags = pgTable(
  "reconciliation_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: reconciliationFlagKindEnum("kind").notNull(),
    provider: providerEnum("provider").notNull(),
    ref: text("ref").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    // Partial: only one *unresolved* flag per (kind, provider, ref). A
    // resolved flag doesn't block a new one from being raised later, and
    // this is the arbiter Postgres needs for `ON CONFLICT ... DO NOTHING`
    // to make flagging race-safe instead of relying on a check-then-insert.
    uniqueIndex("reconciliation_flags_kind_provider_ref_unresolved_unique")
      .on(table.kind, table.provider, table.ref)
      .where(sql`${table.resolvedAt} is null`),
  ],
);

export type ReconciliationFlag = typeof reconciliationFlags.$inferSelect;
export type NewReconciliationFlag = typeof reconciliationFlags.$inferInsert;
