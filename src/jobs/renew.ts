import { renewDueSubscriptions, type RenewDueSubscriptionsSummary } from "@/core/billing/subscriptions/renew";
import type { DbOrTx } from "@/db/client";
import { createProvider } from "@/providers/registry";

/** Runs the (typically daily) subscription renewal job against every provider. */
export async function runRenewals(db: DbOrTx): Promise<RenewDueSubscriptionsSummary> {
  return renewDueSubscriptions(db, { stripe: createProvider("stripe"), paystack: createProvider("paystack") });
}
