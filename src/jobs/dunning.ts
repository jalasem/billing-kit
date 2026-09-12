import { runDunningJob, type DunningJobSummary } from "@/core/billing/dunning/run";
import { defaultNotifier } from "@/core/notify";
import type { DbOrTx } from "@/db/client";
import { buildLiveProviders } from "@/providers/registry";

/** Runs the hourly dunning job against every configured provider. */
export async function runDunning(db: DbOrTx): Promise<DunningJobSummary> {
  return runDunningJob(db, buildLiveProviders("jobs/dunning"), { notifier: defaultNotifier() });
}
