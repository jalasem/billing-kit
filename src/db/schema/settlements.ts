import { bigint, char, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { entries } from "./entries";
import { providerEnum } from "./enums";

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    settlementId: text("settlement_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    entryId: uuid("entry_id").references(() => entries.id),
  },
  (table) => [unique("settlements_provider_settlement_id_unique").on(table.provider, table.settlementId)],
);

export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
