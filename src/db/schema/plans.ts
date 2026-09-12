import { bigint, boolean, char, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { planIntervalEnum } from "./enums";
import { products } from "./products";

/** `provider_refs` maps a provider id to that provider's price/plan id, e.g. `{ stripe: "price_123" }`. */
export interface PlanProviderRefs {
  stripe?: string;
  paystack?: string;
  fake?: string;
}

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(),
  interval: planIntervalEnum("interval").notNull(),
  intervalCount: integer("interval_count").notNull().default(1),
  trialDays: integer("trial_days").notNull().default(0),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  providerRefs: jsonb("provider_refs").$type<PlanProviderRefs>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
