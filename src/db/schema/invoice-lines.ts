import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { invoiceLineKindEnum } from "./enums";
import { invoices } from "./invoices";
import { plans } from "./plans";

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  kind: invoiceLineKindEnum("kind").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmount: bigint("unit_amount", { mode: "bigint" }).notNull(),
  // Signed: negative for a credit or a proration credit line.
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  planId: uuid("plan_id").references(() => plans.id),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
});

export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
