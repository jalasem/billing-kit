import type Stripe from "stripe";
import { z } from "zod";
import { moneySchema } from "@/core/money/schema";
import { ProviderPayloadError } from "../errors";
import type { Money, NormalisedEvent } from "../types";

const stripeIdSchema = z.string().min(1, "expected a non-empty Stripe id");
const stripeTimestampSchema = z.number().finite();

/** Reads an expandable Stripe reference: a bare id string, or the expanded object. */
function expandedOrUndefined<T extends { id: string }>(value: string | T | null | undefined): T | undefined {
  return value && typeof value === "object" ? value : undefined;
}

function idOf<T extends { id: string }>(value: string | T | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

function parseMoney(amount: unknown, currency: unknown): Money {
  return moneySchema.parse({ amount, currency });
}

function parseOptionalMoney(amount: unknown, currency: unknown): Money | undefined {
  if (amount === undefined || amount === null) {
    return undefined;
  }
  return parseMoney(amount, currency);
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
  return parseOptionalMoney(balanceTransaction.fee, balanceTransaction.currency);
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

/**
 * Modern Stripe invoices don't carry `subscription` at the top level either
 * (also removed in favour of `parent.subscription_details.subscription`).
 * Used to link an `invoice.paid`/`invoice.payment_failed` event back to a
 * billing-kit invoice for the same subscription (see
 * `linkInvoiceBySubscription`) when `provider_ref` alone doesn't match —
 * this expansion depth (like `paymentIntentFromInvoice`'s) is unverified
 * against a real test-mode event; see the M3 fix-round report.
 */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
  return idOf(invoice.parent?.subscription_details?.subscription ?? undefined);
}

/**
 * The service period Stripe reports for the invoice, read off its first
 * line item (Stripe invoices don't carry a single top-level period once a
 * subscription can be prorated across several lines; the first line is
 * treated as representative — good enough for the "which billing-kit
 * invoice is this reporting on" matching, not for exact reconciliation).
 * Stripe documents both bounds as inclusive, unlike billing-kit's own
 * period_start-inclusive/period_end-exclusive convention — left as-is
 * (unverified) rather than guessing at an off-by-one adjustment.
 */
function periodFromInvoice(invoice: Stripe.Invoice): { periodStart?: Date; periodEnd?: Date } {
  const period = invoice.lines?.data[0]?.period;
  if (!period) {
    return {};
  }
  return { periodStart: new Date(period.start * 1000), periodEnd: new Date(period.end * 1000) };
}

/**
 * Picks the refund `charge.refunded` is actually reporting. Stripe's
 * `refunds` list is not documented to be in any particular order and can
 * contain every refund ever applied to the charge, not just this event's:
 * prefer the refund `previous_attributes.refunds` didn't have yet (the one
 * this event added), falling back to the most recently created refund when
 * there is nothing to diff against. In practice `previous_attributes` is
 * only populated on `*.updated` events per Stripe's docs, so — despite the
 * defensive check — `charge.refunded` almost always falls through to the
 * `created`-desc sort; see the report's guessed-shapes list.
 */
function mostRecentRefund(charge: Stripe.Charge, previousAttributes: unknown): Stripe.Refund | undefined {
  const refunds = charge.refunds?.data ?? [];
  if (refunds.length === 0) {
    return undefined;
  }

  const previousRefunds = (previousAttributes as { refunds?: { data?: Stripe.Refund[] } } | undefined)?.refunds?.data;
  if (previousRefunds) {
    const previousIds = new Set(previousRefunds.map((refund) => refund.id));
    const newlyAdded = refunds.filter((refund) => !previousIds.has(refund.id));
    if (newlyAdded.length > 0) {
      return newlyAdded.reduce((latest, refund) => (refund.created > latest.created ? refund : latest));
    }
  }

  return [...refunds].sort((a, b) => b.created - a.created)[0];
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

function subscriptionStatusFor(rawStatus: string): SubscriptionStatus {
  const mapped = SUBSCRIPTION_STATUS[rawStatus as Stripe.Subscription.Status];
  if (!mapped) {
    throw new Error(`Unrecognized Stripe subscription status: "${rawStatus}"`);
  }
  return mapped;
}

/** Maps one Stripe event to our normalised vocabulary, or `undefined` for a type we don't handle. */
export function mapStripeEvent(event: Stripe.Event): NormalisedEvent | undefined {
  try {
    return mapStripeEventUnsafe(event);
  } catch (error) {
    throw new ProviderPayloadError("stripe", event.type, error);
  }
}

function mapStripeEventUnsafe(event: Stripe.Event): NormalisedEvent | undefined {
  const providerEventId = stripeIdSchema.parse(event.id);
  const occurredAt = new Date(stripeTimestampSchema.parse(event.created) * 1000);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const providerRef = stripeIdSchema.parse(idOf(session.payment_intent) ?? session.id);
      return {
        type: "payment.succeeded",
        providerEventId,
        providerRef,
        customerRef: idOf(session.customer) ?? undefined,
        money: parseMoney(session.amount_total, session.currency),
        fee: feeFromExpandedPaymentIntent(session.payment_intent),
        occurredAt,
        raw: event,
      };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const paymentIntent = paymentIntentFromInvoice(invoice);
      const providerRef = stripeIdSchema.parse(idOf(paymentIntent) ?? invoice.id);
      return {
        type: "payment.succeeded",
        providerEventId,
        providerRef,
        customerRef: idOf(invoice.customer) ?? undefined,
        money: parseMoney(invoice.amount_paid, invoice.currency),
        fee: feeFromExpandedPaymentIntent(paymentIntent),
        providerSubscriptionId: subscriptionIdFromInvoice(invoice),
        ...periodFromInvoice(invoice),
        occurredAt,
        raw: event,
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const providerRef = stripeIdSchema.parse(idOf(paymentIntentFromInvoice(invoice)) ?? invoice.id);
      return {
        type: "payment.failed",
        providerEventId,
        providerRef,
        customerRef: idOf(invoice.customer) ?? undefined,
        money: parseMoney(invoice.amount_due, invoice.currency),
        reason: invoice.last_finalization_error?.message ?? undefined,
        providerSubscriptionId: subscriptionIdFromInvoice(invoice),
        ...periodFromInvoice(invoice),
        occurredAt,
        raw: event,
      };
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const refund = mostRecentRefund(charge, event.data.previous_attributes);
      if (!refund) {
        return undefined;
      }
      return {
        type: "refund.succeeded",
        providerEventId,
        providerRef: stripeIdSchema.parse(refund.id),
        paymentRef: stripeIdSchema.parse(idOf(charge.payment_intent) ?? charge.id),
        money: parseMoney(refund.amount, refund.currency),
        occurredAt,
        raw: event,
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return {
        type: "subscription.updated",
        providerEventId,
        providerSubscriptionId: stripeIdSchema.parse(subscription.id),
        customerRef: idOf(subscription.customer) ?? undefined,
        status: subscriptionStatusFor(subscription.status),
        occurredAt,
        raw: event,
      };
    }

    case "payout.paid": {
      const payout = event.data.object as Stripe.Payout;
      const money = parseMoney(payout.amount, payout.currency);
      return {
        type: "settlement.posted",
        providerEventId,
        settlementId: stripeIdSchema.parse(payout.id),
        money,
        // Stripe absorbs the payout transfer cost; there is no separate fee
        // to post here (see src/jobs/reconcile.ts for the per-provider rule).
        fee: { amount: 0n, currency: money.currency },
        occurredAt,
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
