import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { plans, type Plan, type PlanProviderRefs } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";

export interface CreatePlanInput {
  productId: string;
  name: string;
  interval: "month" | "year";
  intervalCount?: number;
  trialDays?: number;
  amount: bigint;
  currency: string;
  active?: boolean;
}

/**
 * Creates a plan row, creating the provider-side plan/price first when the
 * caller didn't already supply one in `provider_refs` for `provider.id`.
 */
export async function createPlan(db: DbOrTx, provider: PaymentProvider, input: CreatePlanInput): Promise<Plan> {
  const { providerPlanId } = await provider.createPlan({
    name: input.name,
    money: { amount: input.amount, currency: input.currency },
    interval: input.interval,
    intervalCount: input.intervalCount ?? 1,
  });

  const providerRefs: PlanProviderRefs = { [provider.id]: providerPlanId };

  const [plan] = await db
    .insert(plans)
    .values({
      productId: input.productId,
      name: input.name,
      interval: input.interval,
      intervalCount: input.intervalCount ?? 1,
      trialDays: input.trialDays ?? 0,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      providerRefs,
      active: input.active ?? true,
    })
    .returning();

  return plan;
}

export async function getPlanById(db: DbOrTx, planId: string): Promise<Plan> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) {
    throw new Error(`Unknown plan: ${planId}`);
  }
  return plan;
}
