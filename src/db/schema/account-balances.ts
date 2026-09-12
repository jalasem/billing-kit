import { sql } from "drizzle-orm";
import { bigint, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const accountBalances = pgTable("account_balances", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id),
  balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountBalance = typeof accountBalances.$inferSelect;
export type NewAccountBalance = typeof accountBalances.$inferInsert;
