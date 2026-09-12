import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ConsoleNotifier, notify, type Notifier } from "@/core/notify";
import { customers, dunningAttempts, subscriptions, type Invoice } from "@/db/schema";
import { transition } from "../subscriptions/state";

/**
 * Common tail of "an invoice-linked payment just succeeded": skip any
 * still-pending dunning attempts for it (there is nothing left to retry)
 * and, if its subscription was `past_due`/`unpaid`, bring it back to
 * `active` and notify the customer. Shared by the dunning job's own
 * kit-mode charge success path and by the webhook handler's invoice-linked
 * `payment.succeeded` path (a provider-mode subscription recovering
 * through the provider's own retry). Idempotent: a subscription that's
 * already `active`, or an invoice with no pending attempts left, is a
 * no-op.
 */
export async function recoverSubscriptionForPaidInvoice(db: DbOrTx, invoice: Invoice, notifier: Notifier = new ConsoleNotifier()): Promise<void> {
  await db
    .update(dunningAttempts)
    .set({ executedAt: new Date(), outcome: "skipped" })
    .where(and(eq(dunningAttempts.invoiceId, invoice.id), isNull(dunningAttempts.executedAt)));

  if (!invoice.subscriptionId) {
    return;
  }

  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, invoice.subscriptionId));
  if (!subscription || (subscription.status !== "past_due" && subscription.status !== "unpaid")) {
    return;
  }

  const nextStatus = transition(subscription.status, "payment_recovered");
  await db.update(subscriptions).set({ status: nextStatus, updatedAt: new Date() }).where(eq(subscriptions.id, subscription.id));

  const [customer] = await db.select().from(customers).where(eq(customers.id, subscription.customerId));
  if (customer) {
    await notify(db, notifier, "payment_recovered", customer.email, { invoiceNumber: invoice.number });
  }
}
