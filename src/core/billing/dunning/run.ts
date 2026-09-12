import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { attemptInvoicePayment } from "@/core/billing/invoices/attempt-payment";
import { voidInvoice } from "@/core/billing/invoices/void";
import { ConsoleNotifier, notify, type Notifier } from "@/core/notify";
import { customers, dunningAttempts, invoices, plans, subscriptions } from "@/db/schema";
import type { PaymentProvider, ProviderId } from "@/providers/types";
import { addDays } from "../dates";
import { transition } from "../subscriptions/state";
import { DUNNING_CANCEL_AFTER_DAYS, DUNNING_GRACE_DAYS } from "./config";
import { dunningModeFor } from "./mode";
import { recoverSubscriptionForPaidInvoice } from "./recover";

export interface DunningJobSummary {
  attempted: number;
  recovered: number;
  failed: number;
  movedToUnpaid: number;
  cancelled: number;
}

export interface RunDunningJobOptions {
  notifier?: Notifier;
  now?: Date;
}

/**
 * The hourly dunning job. Runs entirely inside one transaction so the
 * `FOR UPDATE SKIP LOCKED` select and every attempt it processes commit (or
 * roll back) together, with each attempt's own work nested in a savepoint
 * (`tx.transaction`) so one bad attempt can't take the rest of the batch
 * down. `executed_at IS NULL` is the source of truth for "not yet run" —
 * re-running this within the same hour (or concurrently) picks up nothing
 * a prior/other run already executed, and `SKIP LOCKED` means an
 * overlapping run just skips rows the first run still holds.
 */
export async function runDunningJob(
  db: DbOrTx,
  providers: Partial<Record<ProviderId, PaymentProvider>>,
  options: RunDunningJobOptions = {},
): Promise<DunningJobSummary> {
  const notifier = options.notifier ?? new ConsoleNotifier();
  const now = options.now ?? new Date();

  const summary: DunningJobSummary = { attempted: 0, recovered: 0, failed: 0, movedToUnpaid: 0, cancelled: 0 };

  return db.transaction(async (tx) => {
    const dueAttempts = await tx
      .select()
      .from(dunningAttempts)
      .where(and(isNull(dunningAttempts.executedAt), lte(dunningAttempts.scheduledFor, now)))
      .orderBy(asc(dunningAttempts.scheduledFor))
      .for("update", { skipLocked: true });

    for (const attempt of dueAttempts) {
      await tx.transaction(async (savepoint) => {
        const [invoice] = await savepoint.select().from(invoices).where(eq(invoices.id, attempt.invoiceId));
        if (!invoice || invoice.status !== "open" || !invoice.subscriptionId) {
          await savepoint
            .update(dunningAttempts)
            .set({ executedAt: now, outcome: "skipped" })
            .where(eq(dunningAttempts.id, attempt.id));
          return;
        }

        const [customer] = await savepoint.select().from(customers).where(eq(customers.id, invoice.customerId));
        const provider = providers[invoice.provider];
        const mode = dunningModeFor(customer, invoice.provider);

        if (mode !== "kit" || !provider) {
          // Provider mode: the provider retries and reports back via its
          // own webhook. This tracking row just records that the window
          // opened; nothing to charge here.
          await savepoint
            .update(dunningAttempts)
            .set({ executedAt: now, outcome: "skipped" })
            .where(eq(dunningAttempts.id, attempt.id));
          return;
        }

        summary.attempted += 1;
        const result = await attemptInvoicePayment(savepoint, provider, invoice, customer);

        if (result.succeeded) {
          await savepoint
            .update(dunningAttempts)
            .set({ executedAt: now, outcome: "succeeded", providerRef: result.providerRef })
            .where(eq(dunningAttempts.id, attempt.id));

          const [paidInvoice] = await savepoint.select().from(invoices).where(eq(invoices.id, invoice.id));
          await recoverSubscriptionForPaidInvoice(savepoint, paidInvoice, notifier);
          summary.recovered += 1;
          return;
        }

        await savepoint
          .update(dunningAttempts)
          .set({ executedAt: now, outcome: "failed", error: result.error })
          .where(eq(dunningAttempts.id, attempt.id));
        summary.failed += 1;

        const [nextAttempt] = await savepoint
          .select()
          .from(dunningAttempts)
          .where(and(eq(dunningAttempts.invoiceId, invoice.id), isNull(dunningAttempts.executedAt)))
          .orderBy(asc(dunningAttempts.attemptNo))
          .limit(1);

        if (nextAttempt) {
          await notify(savepoint, notifier, "retry_scheduled", customer.email, {
            invoiceNumber: invoice.number,
            nextAttemptAt: nextAttempt.scheduledFor.toISOString(),
          });
        }
      });
    }

    await applyGraceAndCancelAfter(tx, notifier, now, summary);

    return summary;
  });
}

/**
 * Grace and cancel-after transitions, driven off each open invoice's first
 * (attempt_no = 1) dunning attempt — recorded at the moment of failure, so
 * "days since failure" is just `now - firstAttempt.scheduledFor`.
 */
async function applyGraceAndCancelAfter(
  tx: DbOrTx,
  notifier: Notifier,
  now: Date,
  summary: DunningJobSummary,
): Promise<void> {
  const candidates = await tx
    .select({
      subscription: subscriptions,
      invoice: invoices,
      customer: customers,
      plan: plans,
      firstAttempt: dunningAttempts,
    })
    .from(subscriptions)
    .innerJoin(invoices, and(eq(invoices.subscriptionId, subscriptions.id), eq(invoices.status, "open")))
    .innerJoin(customers, eq(customers.id, subscriptions.customerId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(dunningAttempts, and(eq(dunningAttempts.invoiceId, invoices.id), eq(dunningAttempts.attemptNo, 1)))
    .where(inArray(subscriptions.status, ["past_due", "unpaid"]));

  for (const row of candidates) {
    const cancelAt = addDays(row.firstAttempt.scheduledFor, DUNNING_CANCEL_AFTER_DAYS);
    if (now >= cancelAt) {
      const nextStatus = transition(row.subscription.status, "cancel");
      await tx
        .update(subscriptions)
        .set({ status: nextStatus, cancelledAt: now, updatedAt: now })
        .where(eq(subscriptions.id, row.subscription.id));
      await voidInvoice(tx, row.invoice, "uncollectible");
      await notify(tx, notifier, "subscription_cancelled", row.customer.email, { planName: row.plan.name });
      summary.cancelled += 1;
      continue;
    }

    if (row.subscription.status !== "past_due") {
      continue;
    }

    const graceAt = addDays(row.firstAttempt.scheduledFor, DUNNING_GRACE_DAYS);
    if (now < graceAt) {
      continue;
    }

    const [pendingAttempt] = await tx
      .select({ id: dunningAttempts.id })
      .from(dunningAttempts)
      .where(and(eq(dunningAttempts.invoiceId, row.invoice.id), isNull(dunningAttempts.executedAt)))
      .limit(1);
    if (pendingAttempt) {
      continue;
    }

    const nextStatus = transition(row.subscription.status, "grace_expired");
    await tx
      .update(subscriptions)
      .set({ status: nextStatus, updatedAt: now })
      .where(eq(subscriptions.id, row.subscription.id));
    summary.movedToUnpaid += 1;
  }
}
