import type Stripe from "stripe";
import type { Money, NormalisedEvent } from "../types";

/** Reads an expandable Stripe reference: a bare id string, or the expanded object. */
function expandedOrUndefined<T extends { id: string }>(value: string | T | null | undefined): T | undefined {
  return value && typeof value === "object" ? value : undefined;
}

function idOf<T extends { id: string }>(value: string | T | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

/**
 * Stripe webhooks do not include the balance transaction (and therefore the
 * fee) unless the event was configured to expand
 * `payment_intent.latest_charge.balance_transaction`. When it is expanded,
 * we read the fee straight off it; otherwise we omit `fee` entirely, per
 * the brief. This expansion depth is the part most worth checking against a
 * real test-mode event (see the report).
 */
function feeFromExpandedPaymentIntent(
  paymentIntent: string | Stripe.PaymentIntent | null | undefined,
): Money | undefined {
  const intent = expandedOrUndefined(paymentIntent);
  const charge = expandedOrUndefined(intent?.latest_charge);
  const balanceTransaction = expandedOrUndefined(charge?.balance_transaction);
  if (!balanceTransaction) {
    return undefined;
  }
  return { amount: BigInt(balanceTransaction.fee), currency: balanceTransaction.currency.toUpperCase() };
}

/**
 * Modern Stripe invoices don't carry `payment_intent` directly (that field
 * was removed); the payment intent lives on `invoice.payments[0].payment`
 * instead, which is only populated once a payment has actually been
 * attempted against the invoice.
 */
function paymentIntentFromInvoice(invoice: Stripe.Invoice): string | Stripe.PaymentIntent | undefined {
  const firstPayment = invoice.payments?.data[0]?.payment;
  return firstPayment?.type === "payment_intent" ? firstPayment.payment_intent : undefined;
}

type SubscriptionStatus = Extract<NormalisedEvent, { type: "subscription.updated" }>["status"];

const SUBSCRIPTION_STATUS: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  active: "active",
  past_due: "past_due",
  canceled: "cancelled",
  trialing: "trialing",
  unpaid: "unpaid",
  paused: "paused",
  incomplete: "unpaid",
  incomplete_expired: "cancelled",
};

/** Maps one Stripe event to our normalised vocabulary, or `undefined` for a type we don't handle. */
export function mapStripeEvent(event: Stripe.Event): NormalisedEvent | undefined {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const providerRef = idOf(session.payment_intent) ?? session.id;
      return {
        type: "payment.succeeded",
        providerEventId: event.id,
        providerRef,
        customerRef: idOf(session.customer) ?? undefined,
        money: { amount: BigInt(session.amount_total ?? 0), currency: (session.currency ?? "usd").toUpperCase() },
        fee: feeFromExpandedPaymentIntent(session.payment_intent),
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const paymentIntent = paymentIntentFromInvoice(invoice);
      const providerRef = idOf(paymentIntent) ?? invoice.id!;
      return {
        type: "payment.succeeded",
        providerEventId: event.id,
        providerRef,
        customerRef: idOf(invoice.customer) ?? undefined,
        money: { amount: BigInt(invoice.amount_paid), currency: invoice.currency.toUpperCase() },
        fee: feeFromExpandedPaymentIntent(paymentIntent),
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const providerRef = idOf(paymentIntentFromInvoice(invoice)) ?? invoice.id!;
      return {
        type: "payment.failed",
        providerEventId: event.id,
        providerRef,
        customerRef: idOf(invoice.customer) ?? undefined,
        money: { amount: BigInt(invoice.amount_due), currency: invoice.currency.toUpperCase() },
        reason: invoice.last_finalization_error?.message ?? undefined,
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const refund = charge.refunds?.data[0];
      if (!refund) {
        return undefined;
      }
      return {
        type: "refund.succeeded",
        providerEventId: event.id,
        providerRef: refund.id,
        paymentRef: idOf(charge.payment_intent) ?? charge.id,
        money: { amount: BigInt(refund.amount), currency: refund.currency.toUpperCase() },
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return {
        type: "subscription.updated",
        providerEventId: event.id,
        providerSubscriptionId: subscription.id,
        customerRef: idOf(subscription.customer) ?? undefined,
        status: SUBSCRIPTION_STATUS[subscription.status],
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    case "payout.paid": {
      const payout = event.data.object as Stripe.Payout;
      return {
        type: "settlement.posted",
        providerEventId: event.id,
        settlementId: payout.id,
        money: { amount: BigInt(payout.amount), currency: payout.currency.toUpperCase() },
        // Stripe absorbs the payout transfer cost; there is no separate fee
        // to post here (see src/jobs/reconcile.ts for the per-provider rule).
        fee: { amount: 0n, currency: payout.currency.toUpperCase() },
        occurredAt: new Date(event.created * 1000),
        raw: event,
      };
    }

    default:
      return undefined;
  }
}

/** Cheap, non-parsing peek at a raw Stripe webhook body, used only to log/record event types we don't map. */
export function extractStripeEnvelope(rawBody: string): { eventId: string; type: string } {
  const body = JSON.parse(rawBody) as { id: string; type: string };
  return { eventId: body.id, type: body.type };
}
