import { z } from "zod";
import { moneySchema } from "@/core/money/schema";
import { ProviderPayloadError } from "../errors";
import type { Money, NormalisedEvent } from "../types";

type SubscriptionStatus = Extract<NormalisedEvent, { type: "subscription.updated" }>["status"];

/** Paystack ids are sometimes numeric (e.g. `data.id`), sometimes strings (e.g. `data.reference`). */
const paystackRefSchema = z.union([z.string().min(1), z.number()]).transform(String);

function parseMoney(amount: unknown, currency: unknown): Money {
  return moneySchema.parse({ amount, currency });
}

function parseOptionalMoney(amount: unknown, currency: unknown): Money | undefined {
  if (amount === undefined || amount === null) {
    return undefined;
  }
  return parseMoney(amount, currency);
}

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
 * handle. Any field this reads that turns out missing or the wrong shape
 * (amount, currency, ids, fees, timestamps) surfaces as a
 * `ProviderPayloadError`, not a raw `TypeError`.
 */
export function mapPaystackEvent(envelope: { event: string; data: unknown }): NormalisedEvent | undefined {
  try {
    return mapPaystackEventUnsafe(envelope);
  } catch (error) {
    throw new ProviderPayloadError("paystack", envelope.event, error);
  }
}

function mapPaystackEventUnsafe(envelope: { event: string; data: unknown }): NormalisedEvent | undefined {
  const occurredAtFallback = new Date();

  switch (envelope.event) {
    case "charge.success": {
      const data = envelope.data as PaystackChargeSuccessData;
      const money = parseMoney(data.amount, data.currency);
      const fee = parseOptionalMoney(data.fees, data.currency);
      return {
        type: "payment.succeeded",
        providerEventId: syntheticEventId(envelope.event, data.reference),
        providerRef: paystackRefSchema.parse(data.reference),
        customerRef: data.customer?.customer_code,
        money,
        fee,
        occurredAt: data.paid_at ? new Date(data.paid_at) : (data.created_at ? new Date(data.created_at) : occurredAtFallback),
        raw: envelope,
      };
    }

    case "invoice.payment_failed": {
      const data = envelope.data as PaystackInvoicePaymentFailedData;
      const providerRef = paystackRefSchema.parse(data.transaction?.reference ?? data.id);
      const money = parseMoney(data.amount, data.transaction?.currency ?? "NGN");
      return {
        type: "payment.failed",
        providerEventId: syntheticEventId(envelope.event, providerRef),
        providerRef,
        customerRef: data.customer?.customer_code,
        money,
        reason: data.description ?? undefined,
        occurredAt: data.created_at ? new Date(data.created_at) : occurredAtFallback,
        raw: envelope,
      };
    }

    case "refund.processed": {
      const data = envelope.data as PaystackRefundProcessedData;
      const money = parseMoney(data.amount, data.currency);
      return {
        type: "refund.succeeded",
        providerEventId: syntheticEventId(envelope.event, data.id),
        providerRef: paystackRefSchema.parse(data.id),
        paymentRef: paystackRefSchema.parse(data.transaction.reference),
        money,
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
      const providerSubscriptionId = paystackRefSchema.parse(
        data.subscription_code ?? data.subscription?.subscription_code ?? "unknown",
      );
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
      const money = parseMoney(data.amount, data.currency);
      const settlementId = paystackRefSchema.parse(data.transfer_code);
      return {
        type: "settlement.posted",
        providerEventId: syntheticEventId(envelope.event, settlementId),
        settlementId,
        money,
        // Paystack deducts its transaction fee from each charge as it
        // happens (already posted via charge.success); there is no
        // additional fee to post when the batch settles to the bank.
        fee: { amount: 0n, currency: money.currency },
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
