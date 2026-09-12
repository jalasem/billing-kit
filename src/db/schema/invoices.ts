import { sql } from "drizzle-orm";
import { bigint, char, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { entries } from "./entries";
import { invoiceStatusEnum, providerEnum } from "./enums";
import { subscriptions } from "./subscriptions";

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    status: invoiceStatusEnum("status").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    subtotal: bigint("subtotal", { mode: "bigint" }).notNull(),
    total: bigint("total", { mode: "bigint" }).notNull(),
    amountPaid: bigint("amount_paid", { mode: "bigint" }).notNull().default(sql`0`),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    provider: providerEnum("provider").notNull(),
    providerRef: text("provider_ref"),
    issuedEntryId: uuid("issued_entry_id").references(() => entries.id),
    paidEntryId: uuid("paid_entry_id").references(() => entries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotent issuance: `issueInvoiceForPeriod` is a no-op the second
    // time it's called for the same subscription and period.
    uniqueIndex("invoices_subscription_id_period_start_unique").on(table.subscriptionId, table.periodStart),
    // "unique per provider": a provider ref only has to be unique among
    // rows that actually have one, so a checkout not yet attempted (still
    // null) never collides.
    uniqueIndex("invoices_provider_provider_ref_unique")
      .on(table.provider, table.providerRef)
      .where(sql`${table.providerRef} is not null`),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
