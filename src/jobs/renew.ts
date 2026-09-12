import { renewDueSubscriptions, type RenewDueSubscriptionsSummary } from "@/core/billing/subscriptions/renew";
import type { DbOrTx } from "@/db/client";
import { buildLiveProviders } from "@/providers/registry";

/** Runs the (typically daily) subscription renewal job against every configured provider. */
export async function runRenewals(db: DbOrTx): Promise<RenewDueSubscriptionsSummary> {
  return renewDueSubscriptions(db, buildLiveProviders("jobs/renew"));
}
