import type { Money, NormalisedEvent } from "../types";

type SubscriptionStatus = Extract<NormalisedEvent, { type: "subscription.updated" }>["status"];

interface PaystackCustomer {
  customer_code?: string;
  email?: string;
}

interface PaystackChargeSuccessData {
  reference: string;
  amount: number;
  currency: string;
  fees?: number | null;
  paid_at?: string;
  created_at?: string;
  customer?: PaystackCustomer;
}

interface PaystackInvoicePaymentFailedData {
  id: number;
  amount: number;
  description?: string | null;
  created_at?: string;
  customer?: PaystackCustomer;
  transaction?: { reference?: string; currency?: string };
}

interface PaystackRefundProcessedData {
  id: number;
  amount: number;
  currency: string;
  refunded_at?: string;
  created_at?: string;
  transaction: { reference: string };
}

interface PaystackSubscriptionData {
  subscription_code?: string;
  status?: string;
  createdAt?: string;
  customer?: PaystackCustomer;
  subscription?: { subscription_code?: string; status?: string };
}

interface PaystackTransferSuccessData {
  transfer_code: string;
  reference?: string;
  amount: number;
  currency: string;
  transferred_at?: string;
  created_at?: string;
}

/** Paystack does not put a stable event id in the envelope; we derive one from the event name plus the record it describes. */
function syntheticEventId(eventName: string, ref: string | number): string {
  return `${eventName}:${ref}`;
}

const SUBSCRIPTION_STATUS_BY_RAW: Record<string, SubscriptionStatus> = {
  active: "active",
  "non-renewing": "active",
  attention: "past_due",
  completed: "cancelled",
  cancelled: "cancelled",
};

function subscriptionStatusFor(eventName: string, data: PaystackSubscriptionData): SubscriptionStatus {
  if (eventName === "subscription.disable") {
    return "cancelled";
  }
  if (eventName === "subscription.create") {
    return "active";
  }
  const raw = data.subscription?.status ?? data.status;
  return (raw ? SUBSCRIPTION_STATUS_BY_RAW[raw] : undefined) ?? "active";
}

/**
 * Maps one already-parsed Paystack webhook envelope (`{ event, data }`) to
 * our normalised vocabulary, or `undefined` for an event type we don't
 * handle.
 */
export function mapPaystackEvent(envelope: { event: string; data: unknown }): NormalisedEvent | undefined {
  const occurredAtFallback = new Date();

  switch (envelope.event) {
    case "charge.success": {
      const data = envelope.data as PaystackChargeSuccessData;
      const currency = data.currency.toUpperCase();
      const fee: Money | undefined =
        typeof data.fees === "number" ? { amount: BigInt(data.fees), currency } : undefined;
      return {
        type: "payment.succeeded",
        providerEventId: syntheticEventId(envelope.event, data.reference),
        providerRef: data.reference,
        customerRef: data.customer?.customer_code,
        money: { amount: BigInt(data.amount), currency },
        fee,
        occurredAt: data.paid_at ? new Date(data.paid_at) : (data.created_at ? new Date(data.created_at) : occurredAtFallback),
        raw: envelope,
      };
    }

    case "invoice.payment_failed": {
      const data = envelope.data as PaystackInvoicePaymentFailedData;
      const providerRef = data.transaction?.reference ?? String(data.id);
      const currency = (data.transaction?.currency ?? "NGN").toUpperCase();
      return {
        type: "payment.failed",
        providerEventId: syntheticEventId(envelope.event, providerRef),
        providerRef,
        customerRef: data.customer?.customer_code,
        money: { amount: BigInt(data.amount), currency },
        reason: data.description ?? undefined,
        occurredAt: data.created_at ? new Date(data.created_at) : occurredAtFallback,
        raw: envelope,
      };
    }

    case "refund.processed": {
      const data = envelope.data as PaystackRefundProcessedData;
      const currency = data.currency.toUpperCase();
      return {
        type: "refund.succeeded",
        providerEventId: syntheticEventId(envelope.event, data.id),
        providerRef: String(data.id),
        paymentRef: data.transaction.reference,
        money: { amount: BigInt(data.amount), currency },
        occurredAt: data.refunded_at
          ? new Date(data.refunded_at)
          : (data.created_at ? new Date(data.created_at) : occurredAtFallback),
        raw: envelope,
      };
    }

    case "subscription.create":
    case "subscription.disable":
    case "subscription.not_renew":
    case "invoice.update": {
      const data = envelope.data as PaystackSubscriptionData;
      const providerSubscriptionId = data.subscription_code ?? data.subscription?.subscription_code ?? "unknown";
      return {
        type: "subscription.updated",
        providerEventId: syntheticEventId(envelope.event, providerSubscriptionId),
        providerSubscriptionId,
        customerRef: data.customer?.customer_code,
        status: subscriptionStatusFor(envelope.event, data),
        occurredAt: data.createdAt ? new Date(data.createdAt) : occurredAtFallback,
        raw: envelope,
      };
    }

    case "transfer.success": {
      const data = envelope.data as PaystackTransferSuccessData;
      const currency = data.currency.toUpperCase();
      const settlementId = data.transfer_code;
      return {
        type: "settlement.posted",
        providerEventId: syntheticEventId(envelope.event, settlementId),
        settlementId,
        money: { amount: BigInt(data.amount), currency },
        // Paystack deducts its transaction fee from each charge as it
        // happens (already posted via charge.success); there is no
        // additional fee to post when the batch settles to the bank.
        fee: { amount: 0n, currency },
        occurredAt: data.transferred_at
          ? new Date(data.transferred_at)
          : (data.created_at ? new Date(data.created_at) : occurredAtFallback),
        raw: envelope,
      };
    }

    default:
      return undefined;
  }
}

/** Cheap, non-parsing peek at a raw Paystack webhook body, used only to log/record event types we don't map. */
export function extractPaystackEnvelope(rawBody: string): { eventId: string; type: string } {
  const body = JSON.parse(rawBody) as { event: string; data?: { id?: string | number; reference?: string } };
  const ref = body.data?.reference ?? body.data?.id ?? "unknown";
  return { eventId: syntheticEventId(body.event, ref), type: body.event };
}
