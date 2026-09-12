import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { providerEnum, reconciliationFlagKindEnum } from "./enums";

export const reconciliationFlags = pgTable("reconciliation_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reconciliationFlagKindEnum("kind").notNull(),
  provider: providerEnum("provider").notNull(),
  ref: text("ref").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type ReconciliationFlag = typeof reconciliationFlags.$inferSelect;
export type NewReconciliationFlag = typeof reconciliationFlags.$inferInsert;
