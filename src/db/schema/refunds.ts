import { bigint, char, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { entries } from "./entries";
import { payments } from "./payments";

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    // Not in the brief's column list, but replay safety needs a dedupe key:
    // without it, replaying a refund.succeeded webhook would insert a second
    // refunds row (postEntry's own idempotency key already stops it from
    // posting a second ledger entry).
    providerRef: text("provider_ref").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("refunds_provider_ref_unique").on(table.providerRef)],
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
