import { bigint, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dunningModeEnum } from "./enums";

/** `provider_refs` maps a provider id to that provider's customer id, e.g. `{ stripe: "cus_123" }`. */
export interface CustomerProviderRefs {
  stripe?: string;
  paystack?: string;
  fake?: string;
}

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  providerRefs: jsonb("provider_refs").$type<CustomerProviderRefs>().notNull().default({}),
  // Paystack authorization code or Stripe payment method id, used by
  // `chargeSavedMethod` for kit-mode renewals and dunning retries.
  defaultAuthorization: text("default_authorization"),
  // Overrides `dunningModeFor`'s per-provider default when set.
  dunningMode: dunningModeEnum("dunning_mode"),
  // Unapplied credit (minor units) from a negative plan-change proration,
  // applied against the customer's next issued invoice.
  customerCredits: bigint("customer_credits", { mode: "bigint" }).notNull().default(sql`0`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
