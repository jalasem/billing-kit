import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { dunningOutcomeEnum } from "./enums";
import { invoices } from "./invoices";

export const dunningAttempts = pgTable(
  "dunning_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    attemptNo: integer("attempt_no").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    outcome: dunningOutcomeEnum("outcome").notNull().default("pending"),
    providerRef: text("provider_ref"),
    error: text("error"),
  },
  (table) => [unique("dunning_attempts_invoice_id_attempt_no_unique").on(table.invoiceId, table.attemptNo)],
);

export type DunningAttempt = typeof dunningAttempts.$inferSelect;
export type NewDunningAttempt = typeof dunningAttempts.$inferInsert;
