import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** `provider_refs` maps a provider id to that provider's customer id, e.g. `{ stripe: "cus_123" }`. */
export interface CustomerProviderRefs {
  stripe?: string;
  paystack?: string;
}

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  providerRefs: jsonb("provider_refs").$type<CustomerProviderRefs>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
