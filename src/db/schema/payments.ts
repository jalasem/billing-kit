import { sql } from "drizzle-orm";
import { bigint, char, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { entries } from "./entries";
import { paymentStatusEnum, providerEnum } from "./enums";

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull().default(sql`0`),
    status: paymentStatusEnum("status").notNull(),
    entryId: uuid("entry_id").references(() => entries.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payments_provider_provider_ref_unique").on(table.provider, table.providerRef),
    index("payments_occurred_at_idx").on(table.occurredAt),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
