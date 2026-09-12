import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ConsoleNotifier, type Notifier } from "@/core/notify";
import { customers, subscriptions, type Invoice, type Subscription } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";
import { addDays, addInterval } from "../dates";
import { startDunningForFailedInvoice } from "../dunning/start";
import { attemptInvoicePayment } from "../invoices/attempt-payment";
import { issueInvoiceForPeriod } from "../invoices/issue";
import { getPlanById } from "../plans";

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  /** Defaults to `true`: a plan with `trial_days > 0` starts trialing unless the caller opts out. */
  startTrial?: boolean;
  now?: Date;
  notifier?: Notifier;
}

export interface CreateSubscriptionResult {
  subscription: Subscription;
  invoice?: Invoice;
}

/**
 * Creates a subscription: ensures the customer and plan both have a
 * provider-side id (creating them if missing), creates the provider
 * subscription, and sets the period. A plan with trial days (and
 * `startTrial` not explicitly `false`) starts `trialing` with no invoice —
 * nothing is owed until the trial ends (see `renewDueSubscriptions`).
 * Otherwise it starts `active` and the first period's invoice is issued
 * and, if the customer already has a saved payment method, charged
 * immediately; a failed first charge moves the subscription to `past_due`
 * and starts dunning the same way a later renewal failure would.
 */
export async function createSubscription(
  db: DbOrTx,
  provider: PaymentProvider,
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
  const plan = await getPlanById(db, input.planId);
  const [customer] = await db.select().from(customers).where(eq(customers.id, input.customerId));
  if (!customer) {
    throw new Error(`Unknown customer: ${input.customerId}`);
  }

  let providerCustomerId = customer.providerRefs[provider.id];
  if (!providerCustomerId) {
    const created = await provider.createCustomer({ email: customer.email, name: customer.name ?? undefined });
    providerCustomerId = created.providerCustomerId;
    await db
      .update(customers)
      .set({ providerRefs: { ...customer.providerRefs, [provider.id]: providerCustomerId } })
      .where(eq(customers.id, customer.id));
  }

  const providerPlanId = plan.providerRefs[provider.id];
  const reference = `sub_${customer.id}_${plan.id}`;
  const providerSubscription = await provider.createSubscription({
    providerCustomerId,
    plan: { providerPlanId, money: { amount: plan.amount, currency: plan.currency }, interval: plan.interval },
    reference,
  });

  const now = input.now ?? new Date();
  const useTrial = (input.startTrial ?? true) && plan.trialDays > 0;
  const periodStart = now;
  const periodEnd = useTrial ? addDays(now, plan.trialDays) : addInterval(now, plan.interval, plan.intervalCount);

  const [subscription] = await db
    .insert(subscriptions)
    .values({
      customerId: customer.id,
      planId: plan.id,
      provider: provider.id,
      providerSubscriptionId: providerSubscription.providerSubscriptionId,
      status: useTrial ? "trialing" : "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEnd: useTrial ? periodEnd : null,
    })
    .returning();

  if (useTrial) {
    return { subscription };
  }

  const { invoice } = await issueInvoiceForPeriod(db, subscription, plan);
  const effectiveCustomer = { ...customer, providerRefs: { ...customer.providerRefs, [provider.id]: providerCustomerId } };

  if (invoice.status === "paid") {
    return { subscription, invoice };
  }

  const attempt = await attemptInvoicePayment(db, provider, invoice, effectiveCustomer);
  if (!attempt.attempted || attempt.succeeded) {
    // Not attempted at all (provider mode, no saved method yet) is not a
    // failure — wait for the provider's own webhook, same as an ordinary
    // provider-mode subscription.
    return { subscription, invoice: attempt.invoice };
  }

  const updated = await startDunningForFailedInvoice(db, provider.id, subscription, attempt.invoice, effectiveCustomer, {
    failedAt: now,
    notifier: input.notifier ?? new ConsoleNotifier(),
  });
  return { subscription: updated, invoice: attempt.invoice };
}
