import { and, eq, inArray, lte } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ConsoleNotifier, type Notifier } from "@/core/notify";
import { customers, subscriptions, type Subscription } from "@/db/schema";
import type { PaymentProvider, ProviderId } from "@/providers/types";
import { addInterval } from "../dates";
import { startDunningForFailedInvoice } from "../dunning/start";
import { attemptInvoicePayment } from "../invoices/attempt-payment";
import { issueInvoiceForPeriod } from "../invoices/issue";
import { getPlanById } from "../plans";
import { transition } from "./state";

export interface RenewDueSubscriptionsSummary {
  renewed: number;
  trialsActivated: number;
  cancelled: number;
  paymentsFailed: number;
}

/**
 * Advances every subscription whose `current_period_end <= now` and whose
 * status is `trialing`, `active`, or `past_due` (a `past_due` subscription
 * still rolls forward — dunning keeps pursuing the old invoice
 * independently of the new period's own invoice and attempt schedule).
 * `cancel_at_period_end` subscriptions are cancelled here instead of
 * renewed. Idempotent: each subscription is re-locked and skipped if
 * another call already advanced it past `now`, and `issueInvoiceForPeriod`
 * is itself idempotent per (subscription, period_start) as a backstop —
 * running this twice in a row issues exactly one invoice per subscription.
 */
export async function renewDueSubscriptions(
  db: DbOrTx,
  providers: Partial<Record<ProviderId, PaymentProvider>>,
  now = new Date(),
  notifier: Notifier = new ConsoleNotifier(),
): Promise<RenewDueSubscriptionsSummary> {
  const summary: RenewDueSubscriptionsSummary = { renewed: 0, trialsActivated: 0, cancelled: 0, paymentsFailed: 0 };

  const due = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["trialing", "active", "past_due"]), lte(subscriptions.currentPeriodEnd, now)));

  for (const { id } of due) {
    await processDueSubscription(db, providers, id, now, notifier, summary);
  }

  return summary;
}

async function processDueSubscription(
  db: DbOrTx,
  providers: Partial<Record<ProviderId, PaymentProvider>>,
  subscriptionId: string,
  now: Date,
  notifier: Notifier,
  summary: RenewDueSubscriptionsSummary,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .for("update", { skipLocked: true });
    if (!locked || locked.currentPeriodEnd > now) {
      return;
    }

    const plan = await getPlanById(tx, locked.planId);
    const [customer] = await tx.select().from(customers).where(eq(customers.id, locked.customerId));
    const provider = providers[locked.provider];

    if (locked.cancelAtPeriodEnd) {
      const nextStatus = transition(locked.status, "cancel");
      await tx
        .update(subscriptions)
        .set({ status: nextStatus, cancelledAt: now, updatedAt: now })
        .where(eq(subscriptions.id, locked.id));
      if (provider && locked.providerSubscriptionId) {
        await provider.cancelSubscription(locked.providerSubscriptionId);
      }
      summary.cancelled += 1;
      return;
    }

    const wasTrialing = locked.status === "trialing";
    const nextStatus = wasTrialing ? transition("trialing", "activate") : transition(locked.status, "period_ended");

    const newPeriodStart = locked.currentPeriodEnd;
    const newPeriodEnd = addInterval(newPeriodStart, plan.interval, plan.intervalCount);

    const [advanced]: Subscription[] = await tx
      .update(subscriptions)
      .set({
        status: nextStatus,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, locked.id))
      .returning();

    if (wasTrialing) {
      summary.trialsActivated += 1;
    } else {
      summary.renewed += 1;
    }

    const { invoice } = await issueInvoiceForPeriod(tx, advanced, plan);
    if (invoice.status === "paid" || !provider) {
      return;
    }

    const attempt = await attemptInvoicePayment(tx, provider, invoice, customer);
    if (!attempt.attempted) {
      // Provider mode (or no saved method yet): nothing to retry ourselves; wait for the provider's own webhook.
      return;
    }

    if (attempt.succeeded) {
      if (advanced.status === "past_due") {
        const recovered = transition("past_due", "payment_recovered");
        await tx.update(subscriptions).set({ status: recovered, updatedAt: now }).where(eq(subscriptions.id, advanced.id));
      }
      return;
    }

    await startDunningForFailedInvoice(tx, locked.provider, advanced, attempt.invoice, customer, { failedAt: now, notifier });
    summary.paymentsFailed += 1;
  });
}
