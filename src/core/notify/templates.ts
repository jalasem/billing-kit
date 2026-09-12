import { format } from "@/core/money/format";
import type { NotificationKind, NotificationTemplate } from "./types";

export interface PaymentFailedPayload {
  invoiceNumber: string;
  /** Minor units, as a string — notification payloads are stored as JSON, which can't carry `bigint`. */
  amount: string;
  currency: string;
}

export function paymentFailedTemplate(payload: PaymentFailedPayload): NotificationTemplate {
  const amount = format(BigInt(payload.amount), payload.currency);
  const subject = `Payment failed for invoice ${payload.invoiceNumber}`;
  const text = `We couldn't collect ${amount} for invoice ${payload.invoiceNumber}. We'll retry automatically over the next few days.`;
  return { subject, text, html: `<p>${text}</p>` };
}

export interface RetryScheduledPayload {
  invoiceNumber: string;
  /** ISO 8601 — notification payloads are stored as JSON, which can't carry `Date`. */
  nextAttemptAt: string;
}

export function retryScheduledTemplate(payload: RetryScheduledPayload): NotificationTemplate {
  const when = payload.nextAttemptAt.slice(0, 10);
  const subject = `We'll retry invoice ${payload.invoiceNumber} on ${when}`;
  const text = `Your last payment attempt for invoice ${payload.invoiceNumber} didn't go through. We'll try again on ${when}.`;
  return { subject, text, html: `<p>${text}</p>` };
}

export interface SubscriptionCancelledPayload {
  planName: string;
}

export function subscriptionCancelledTemplate(payload: SubscriptionCancelledPayload): NotificationTemplate {
  const subject = `Your ${payload.planName} subscription has been cancelled`;
  const text = `We were unable to collect payment after several attempts, so your ${payload.planName} subscription has been cancelled.`;
  return { subject, text, html: `<p>${text}</p>` };
}

export interface PaymentRecoveredPayload {
  invoiceNumber: string;
}

export function paymentRecoveredTemplate(payload: PaymentRecoveredPayload): NotificationTemplate {
  const subject = `Payment received for invoice ${payload.invoiceNumber}`;
  const text = `Thanks — we successfully collected payment for invoice ${payload.invoiceNumber} and your subscription is active again.`;
  return { subject, text, html: `<p>${text}</p>` };
}

/** Dispatches to the template matching `kind`; `payload` is trusted to match that kind's shape (callers control both). */
export function renderTemplate(kind: NotificationKind, payload: Record<string, unknown>): NotificationTemplate {
  switch (kind) {
    case "payment_failed":
      return paymentFailedTemplate(payload as unknown as PaymentFailedPayload);
    case "retry_scheduled":
      return retryScheduledTemplate(payload as unknown as RetryScheduledPayload);
    case "subscription_cancelled":
      return subscriptionCancelledTemplate(payload as unknown as SubscriptionCancelledPayload);
    case "payment_recovered":
      return paymentRecoveredTemplate(payload as unknown as PaymentRecoveredPayload);
  }
}
