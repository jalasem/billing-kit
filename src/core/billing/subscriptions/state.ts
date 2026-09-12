import type { Subscription } from "@/db/schema";

export type SubscriptionStatus = Subscription["status"];

export type SubscriptionEvent =
  | "activate"
  | "payment_failed"
  | "payment_recovered"
  | "grace_expired"
  | "cancel"
  | "cancel_at_period_end"
  | "period_ended"
  | "pause"
  | "resume";

export class InvalidTransitionError extends Error {
  readonly status: SubscriptionStatus;
  readonly event: SubscriptionEvent;

  constructor(status: SubscriptionStatus, event: SubscriptionEvent) {
    super(`Cannot apply event "${event}" to a subscription in status "${status}"`);
    this.name = "InvalidTransitionError";
    this.status = status;
    this.event = event;
  }
}

/**
 * The subscription state graph (invariant 6). `cancel_at_period_end` is a
 * flag-only event (the caller sets `cancelAtPeriodEnd`; the status itself
 * does not change) — it is only valid from the two statuses a subscription
 * can be actively billing from. `period_ended` models a period rolling
 * over while still in good standing (renewal issued, or a trial elapsing
 * into its first billed period); a period ending while `past_due`/`unpaid`
 * is handled by the dunning job's own transitions (`grace_expired`,
 * `cancel`), not by `period_ended`.
 */
const TRANSITIONS: Record<SubscriptionStatus, Partial<Record<SubscriptionEvent, SubscriptionStatus>>> = {
  trialing: {
    activate: "active",
    cancel: "cancelled",
    cancel_at_period_end: "trialing",
  },
  active: {
    payment_failed: "past_due",
    cancel: "cancelled",
    cancel_at_period_end: "active",
    pause: "paused",
    period_ended: "active",
  },
  past_due: {
    payment_recovered: "active",
    grace_expired: "unpaid",
    cancel: "cancelled",
    // `renewDueSubscriptions` advances the period even while past_due (the
    // brief explicitly includes past_due alongside active): dunning keeps
    // pursuing the old invoice independently, and the new period's own
    // invoice starts its own attempt schedule if it goes unpaid too.
    period_ended: "past_due",
  },
  unpaid: {
    payment_recovered: "active",
    cancel: "cancelled",
  },
  paused: {
    resume: "active",
    cancel: "cancelled",
  },
  cancelled: {},
};

export function transition(status: SubscriptionStatus, event: SubscriptionEvent): SubscriptionStatus {
  const next = TRANSITIONS[status]?.[event];
  if (!next) {
    throw new InvalidTransitionError(status, event);
  }
  return next;
}

export function canTransition(status: SubscriptionStatus, event: SubscriptionEvent): boolean {
  return TRANSITIONS[status]?.[event] !== undefined;
}
