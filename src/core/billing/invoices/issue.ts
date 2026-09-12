import type { DbOrTx } from "@/db/client";
import type { Plan, Subscription } from "@/db/schema";
import { createInvoice, type CreateInvoiceResult } from "./create";

/**
 * Issues the invoice for a subscription's current period: one `charge`
 * line for the plan's full amount, plus any pending customer credit
 * applied automatically. Idempotent per (subscription, period_start) — see
 * `createInvoice`.
 */
export async function issueInvoiceForPeriod(
  db: DbOrTx,
  subscription: Subscription,
  plan: Plan,
): Promise<CreateInvoiceResult> {
  return createInvoice(db, {
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    currency: plan.currency,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    dueAt: subscription.currentPeriodEnd,
    applyCustomerCredit: true,
    lines: [
      {
        kind: "charge",
        description: `${plan.name} (${subscription.currentPeriodStart.toISOString().slice(0, 10)} to ${subscription.currentPeriodEnd.toISOString().slice(0, 10)})`,
        quantity: 1,
        unitAmount: plan.amount,
        amount: plan.amount,
        planId: plan.id,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      },
    ],
  });
}
