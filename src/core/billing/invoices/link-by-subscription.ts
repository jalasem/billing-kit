import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { invoices, subscriptions, type Invoice } from "@/db/schema";
import type { ProviderId } from "@/providers/types";

export interface LinkableEvent {
  providerRef: string;
  providerSubscriptionId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}

/**
 * Provider-mode invoice linkage: when a webhook event carries a
 * `providerSubscriptionId` (a Stripe `invoice.paid`/`invoice.payment_failed`
 * always does; a Paystack `charge.success` sometimes does — see the
 * mapping files), and there is a kit `invoices` row for that subscription
 * whose `provider_ref` is still `null`, this sets that invoice's
 * `provider_ref` to the event's own reference so the caller's normal
 * provider_ref lookup (in `handlePaymentSucceeded`/`handlePaymentFailed`)
 * finds it right after.
 *
 * Picks the invoice whose period contains the event's reported period when
 * one is given; otherwise (or if none contains it) falls back to the most
 * recently started `open` invoice for that subscription — the one most
 * likely to be what the event is reporting on. A no-op if the
 * subscription isn't found, or it has no unlinked open invoice.
 */
export async function linkInvoiceBySubscription(db: DbOrTx, provider: ProviderId, event: LinkableEvent): Promise<void> {
  if (!event.providerSubscriptionId) {
    return;
  }

  const [subscription] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId)));
  if (!subscription) {
    return;
  }

  const candidates = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.subscriptionId, subscription.id), isNull(invoices.providerRef), eq(invoices.status, "open")));
  if (candidates.length === 0) {
    return;
  }

  const target = pickTarget(candidates, event);
  await db.update(invoices).set({ providerRef: event.providerRef }).where(eq(invoices.id, target.id));
}

function pickTarget(candidates: Invoice[], event: LinkableEvent): Invoice {
  if (event.periodStart) {
    const containing = candidates.find((invoice) => invoice.periodStart <= event.periodStart! && event.periodStart! < invoice.periodEnd);
    if (containing) {
      return containing;
    }
  }
  return candidates.reduce((latest, invoice) => (invoice.periodStart > latest.periodStart ? invoice : latest));
}
