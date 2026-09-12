import { runDunningJob, type DunningJobSummary } from "@/core/billing/dunning/run";
import { ConsoleNotifier, ResendNotifier, type Notifier } from "@/core/notify";
import type { DbOrTx } from "@/db/client";
import { createProvider } from "@/providers/registry";

/** `resend` when `RESEND_API_KEY` is set, otherwise the `console` default. */
function defaultNotifier(): Notifier {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return new ConsoleNotifier();
  }
  return new ResendNotifier({ apiKey, from: process.env.RESEND_FROM ?? "billing@example.com" });
}

/** Runs the hourly dunning job against every provider. */
export async function runDunning(db: DbOrTx): Promise<DunningJobSummary> {
  return runDunningJob(
    db,
    { stripe: createProvider("stripe"), paystack: createProvider("paystack") },
    { notifier: defaultNotifier() },
  );
}
