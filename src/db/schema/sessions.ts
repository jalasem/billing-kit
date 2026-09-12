import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";

/**
 * `id` is the opaque session id stored (unhashed) in the `bk_session`
 * cookie. `customer_id` is null for an operator-only session (an operator
 * email that has no customer row of its own).
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customers.id),
  email: text("email").notNull(),
  isOperator: boolean("is_operator").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
