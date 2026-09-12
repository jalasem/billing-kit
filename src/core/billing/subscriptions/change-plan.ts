import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers, subscriptions, type Invoice, type Subscription } from "@/db/schema";
import { createInvoice } from "../invoices/create";
import { getPlanById } from "../plans";
import { prorate, type ProrationResult } from "./proration";

export interface ChangePlanResult {
  subscription: Subscription;
  proration: ProrationResult;
  /** Set only when the proration produced a positive delta (an invoice to collect now). */
  invoice?: Invoice;
}

/**
 * Changes a subscription's plan, prorating the remainder of the current
 * period (see `proration.ts`). A positive delta becomes an immediately
 * `open` invoice; a negative delta is banked as `customer_credits` and
 * applied automatically the next time an invoice is issued for this
 * customer. Locks the subscription row for the duration so a concurrent
 * renewal or cancellation can't race the plan swap.
 *
 * Provider-side plan syncing (e.g. updating a live Stripe subscription's
 * price) is out of scope here — see the M3 report's open questions.
 */
export async function changePlan(db: DbOrTx, subscriptionId: string, newPlanId: string, changeAt = new Date()): Promise<ChangePlanResult> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .for("update");
    if (!subscription) {
      throw new Error(`Unknown subscription: ${subscriptionId}`);
    }

    const oldPlan = await getPlanById(tx, subscription.planId);
    const newPlan = await getPlanById(tx, newPlanId);
    if (oldPlan.currency.toUpperCase() !== newPlan.currency.toUpperCase()) {
      throw new Error(`Cannot change plan across currencies: ${oldPlan.currency} -> ${newPlan.currency}`);
    }

    const proration = prorate({
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      changeAt,
      oldPlanAmount: oldPlan.amount,
      newPlanAmount: newPlan.amount,
    });

    let invoice: Invoice | undefined;
    if (proration.delta > 0n) {
      const created = await createInvoice(tx, {
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        provider: subscription.provider,
        currency: oldPlan.currency,
        periodStart: changeAt,
        periodEnd: subscription.currentPeriodEnd,
        dueAt: changeAt,
        lines: [
          {
            kind: "credit",
            description: `Unused days on ${oldPlan.name}`,
            unitAmount: -proration.unusedCreditOldPlan,
            amount: -proration.unusedCreditOldPlan,
            planId: oldPlan.id,
            periodStart: changeAt,
            periodEnd: subscription.currentPeriodEnd,
          },
          {
            kind: "proration",
            description: `Remaining days on ${newPlan.name}`,
            unitAmount: proration.chargeNewPlan,
            amount: proration.chargeNewPlan,
            planId: newPlan.id,
            periodStart: changeAt,
            periodEnd: subscription.currentPeriodEnd,
          },
        ],
      });
      invoice = created.invoice;
    } else if (proration.delta < 0n) {
      await tx
        .update(customers)
        .set({ customerCredits: sql`${customers.customerCredits} + ${-proration.delta}` })
        .where(eq(customers.id, subscription.customerId));
    }

    const [updated] = await tx
      .update(subscriptions)
      .set({ planId: newPlanId, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscription.id))
      .returning();

    return { subscription: updated, proration, invoice };
  });
}
