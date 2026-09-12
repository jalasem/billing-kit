import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { startDunningForFailedInvoice } from "@/core/billing/dunning/start";
import { linkInvoiceBySubscription } from "@/core/billing/invoices/link-by-subscription";
import { customers, invoices, payments, subscriptions } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";

type PaymentFailedEvent = Extract<NormalisedEvent, { type: "payment.failed" }>;

/**
 * No ledger entry: a failed payment never moved money. If
 * `event.providerRef` matches an `open` invoice tied to a subscription
 * (see `handlePaymentSucceeded`'s matching note, including provider-mode
 * linkage via `linkInvoiceBySubscription`), this is the provider reporting
 * a failed attempt at collecting that invoice — start dunning the same way
 * a kit-mode charge failure does.
 */
export async function handlePaymentFailed(db: DbOrTx, provider: ProviderId, event: PaymentFailedEvent): Promise<void> {
  await db
    .insert(payments)
    .values({
      provider,
      providerRef: event.providerRef,
      amount: event.money.amount,
      currency: event.money.currency.toUpperCase(),
      status: "failed",
      occurredAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [payments.provider, payments.providerRef],
      set: { status: "failed" },
    });

  await linkInvoiceBySubscription(db, provider, event);

  const [linkedInvoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.provider, provider), eq(invoices.providerRef, event.providerRef), eq(invoices.status, "open")));
  if (!linkedInvoice || !linkedInvoice.subscriptionId) {
    return;
  }

  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, linkedInvoice.subscriptionId));
  const [customer] = await db.select().from(customers).where(eq(customers.id, linkedInvoice.customerId));
  if (!subscription || !customer) {
    return;
  }

  await startDunningForFailedInvoice(db, provider, subscription, linkedInvoice, customer, { failedAt: event.occurredAt });
}
