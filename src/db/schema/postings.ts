import { bigint, char, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { entries } from "./entries";

export const postings = pgTable(
  "postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    // Signed minor units. Debit positive, credit negative.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("postings_account_id_created_at_idx").on(table.accountId, table.createdAt),
    index("postings_entry_id_idx").on(table.entryId),
  ],
);

export type Posting = typeof postings.$inferSelect;
export type NewPosting = typeof postings.$inferInsert;
