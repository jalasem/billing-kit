import { desc, eq } from "drizzle-orm";
import { Card } from "@/components/ui";
import { requireCustomerSession } from "@/core/auth";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";

/**
 * Payment methods live with the provider, not billing-kit — this kit
 * never stores card data (see the design doc's non-goals). A real
 * "update payment method" needs a provider-hosted setup flow (Stripe's
 * billing portal, Paystack's equivalent); neither adapter implements one
 * yet, and the `fake` provider's `createCheckoutSession` is a checkout
 * for a charge, not a card-update session, so wiring it up here would be
 * a working button that lies about what it does. We show the truthful
 * state instead — see the M4 report for what a 1.0 provider-hosted flow
 * would need.
 */
export default async function PaymentMethodPage() {
  const session = await requireCustomerSession();
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.customerId, session.customerId))
    .orderBy(desc(subscriptions.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Payment method</h1>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-900">
          {subscription ? (
            <>
              Your payment method is managed by <span className="font-medium">{subscription.provider}</span>.
            </>
          ) : (
            "You don't have a payment method on file yet."
          )}
        </p>
        <p className="text-sm text-slate-600">
          billing-kit does not store card details, and this release does not yet drive your provider&apos;s hosted portal for
          updating a saved card. To change your payment method today, contact support or update it directly with your provider.
        </p>
      </Card>
    </div>
  );
}
