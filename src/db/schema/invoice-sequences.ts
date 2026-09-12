import { sql } from "drizzle-orm";
import { integer, pgTable } from "drizzle-orm/pg-core";

/** One row per calendar year; `next` is the next number `allocateInvoiceNumber` will hand out. */
export const invoiceSequences = pgTable("invoice_sequences", {
  year: integer("year").primaryKey(),
  next: integer("next").notNull().default(sql`1`),
});

export type InvoiceSequence = typeof invoiceSequences.$inferSelect;
export type NewInvoiceSequence = typeof invoiceSequences.$inferInsert;
