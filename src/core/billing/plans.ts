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
  /** Pre-existing provider refs (e.g. a plan already created by hand in the Stripe/Paystack dashboard). A ref already present for `provider.id` skips calling `provider.createPlan`. */
  providerRefs?: PlanProviderRefs;
}

/**
 * Creates a plan row, creating the provider-side plan/price first —
 * *unless* the caller already supplied one in `input.providerRefs` for
 * `provider.id`, in which case that ref is used as-is and no provider call
 * is made at all.
 */
export async function createPlan(db: DbOrTx, provider: PaymentProvider, input: CreatePlanInput): Promise<Plan> {
  const existingRef = input.providerRefs?.[provider.id];
  const providerPlanId =
    existingRef ??
    (
      await provider.createPlan({
        name: input.name,
        money: { amount: input.amount, currency: input.currency },
        interval: input.interval,
        intervalCount: input.intervalCount ?? 1,
      })
    ).providerPlanId;

  const providerRefs: PlanProviderRefs = { ...input.providerRefs, [provider.id]: providerPlanId };

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
