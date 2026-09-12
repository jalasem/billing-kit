import type { DbOrTx } from "@/db/client";
import { createPlan } from "@/core/billing/plans";
import { createProduct } from "@/core/billing/products";
import { customers, type Customer, type Plan } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";

export interface SeedPlanOptions {
  name?: string;
  amount: bigint;
  currency?: string;
  interval?: "month" | "year";
  intervalCount?: number;
  trialDays?: number;
}

/** Creates a product and one plan under it, through the real `createPlan` service (so `provider_refs` is populated). */
export async function seedPlan(db: DbOrTx, provider: PaymentProvider, options: SeedPlanOptions): Promise<Plan> {
  const product = await createProduct(db, { name: options.name ?? "Test product" });
  return createPlan(db, provider, {
    productId: product.id,
    name: options.name ?? "Test plan",
    interval: options.interval ?? "month",
    intervalCount: options.intervalCount ?? 1,
    trialDays: options.trialDays ?? 0,
    amount: options.amount,
    currency: options.currency ?? "USD",
  });
}

export interface SeedCustomerOptions {
  email: string;
  defaultAuthorization?: string;
}

export async function seedCustomer(db: DbOrTx, options: SeedCustomerOptions): Promise<Customer> {
  const [customer] = await db
    .insert(customers)
    .values({ email: options.email, defaultAuthorization: options.defaultAuthorization })
    .returning();
  return customer;
}
