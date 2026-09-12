import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  idempotencyKey: text("idempotency_key").unique(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Entry = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;
