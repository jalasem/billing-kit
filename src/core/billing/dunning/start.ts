import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { dunningAttempts, subscriptions, type Customer, type Invoice, type Subscription } from "@/db/schema";
import { ConsoleNotifier, notify, type Notifier } from "@/core/notify";
import type { ProviderId } from "@/providers/types";
import { addDays } from "../dates";
import { transition } from "../subscriptions/state";
import { DUNNING_SCHEDULE_DAYS } from "./config";
import { dunningModeFor } from "./mode";

/**
 * Reacts to an invoice-linked payment failure: moves the subscription to
 * `past_due` (a no-op if it's already there — a redelivered webhook must
 * not re-run this), schedules the retry attempts (the full kit schedule in
 * "kit" mode, a single tracking row in "provider" mode), and notifies the
 * customer. Scheduling is itself idempotent: if attempts already exist for
 * this invoice, nothing new is created.
 */
export async function startDunningForFailedInvoice(
  db: DbOrTx,
  providerId: ProviderId,
  subscription: Subscription,
  invoice: Invoice,
  customer: Customer,
  options: { notifier?: Notifier; failedAt?: Date } = {},
): Promise<Subscription> {
  const notifier = options.notifier ?? new ConsoleNotifier();
  const failedAt = options.failedAt ?? new Date();

  return db.transaction(async (tx) => {
    let updated = subscription;
    if (subscription.status === "active") {
      const nextStatus = transition(subscription.status, "payment_failed");
      const [row] = await tx
        .update(subscriptions)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(subscriptions.id, subscription.id))
        .returning();
      updated = row;
    }

    const existing = await tx.select().from(dunningAttempts).where(eq(dunningAttempts.invoiceId, invoice.id));
    if (existing.length === 0) {
      const mode = dunningModeFor(customer, providerId);
      const schedule = mode === "kit" ? DUNNING_SCHEDULE_DAYS : [0];
      await tx
        .insert(dunningAttempts)
        .values(
          schedule.map((offsetDays, index) => ({
            invoiceId: invoice.id,
            attemptNo: index + 1,
            scheduledFor: addDays(failedAt, offsetDays),
            outcome: "pending" as const,
          })),
        )
        .onConflictDoNothing({ target: [dunningAttempts.invoiceId, dunningAttempts.attemptNo] });
    }

    await notify(tx, notifier, "payment_failed", customer.email, {
      invoiceNumber: invoice.number,
      amount: invoice.total.toString(),
      currency: invoice.currency,
    });

    return updated;
  });
}
