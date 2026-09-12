import { describe, expect, it } from "vitest";
import { InvalidTransitionError, transition, type SubscriptionEvent, type SubscriptionStatus } from "./state";

const ALLOWED: Array<[SubscriptionStatus, SubscriptionEvent, SubscriptionStatus]> = [
  ["trialing", "activate", "active"],
  ["trialing", "cancel", "cancelled"],
  ["trialing", "cancel_at_period_end", "trialing"],
  ["active", "payment_failed", "past_due"],
  ["active", "cancel", "cancelled"],
  ["active", "cancel_at_period_end", "active"],
  ["active", "pause", "paused"],
  ["active", "period_ended", "active"],
  ["past_due", "payment_recovered", "active"],
  ["past_due", "grace_expired", "unpaid"],
  ["past_due", "cancel", "cancelled"],
  ["past_due", "period_ended", "past_due"],
  ["unpaid", "payment_recovered", "active"],
  ["unpaid", "cancel", "cancelled"],
  ["paused", "resume", "active"],
  ["paused", "cancel", "cancelled"],
];

const DISALLOWED: Array<[SubscriptionStatus, SubscriptionEvent]> = [
  ["cancelled", "activate"],
  ["cancelled", "cancel"],
  ["cancelled", "resume"],
  ["trialing", "payment_failed"],
  ["trialing", "payment_recovered"],
  ["trialing", "pause"],
  ["trialing", "resume"],
  ["active", "activate"],
  ["active", "resume"],
  ["active", "grace_expired"],
  ["past_due", "activate"],
  ["past_due", "pause"],
  ["unpaid", "grace_expired"],
  ["unpaid", "pause"],
  ["unpaid", "activate"],
  ["paused", "payment_failed"],
  ["paused", "period_ended"],
  ["paused", "activate"],
];

describe("subscription state machine (invariant 6)", () => {
  it.each(ALLOWED)("allows %s --%s--> %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it.each(DISALLOWED)("rejects %s --%s-->", (from, event) => {
    expect(() => transition(from, event)).toThrow(InvalidTransitionError);
  });

  it("names the offending status and event on the thrown error", () => {
    try {
      transition("cancelled", "activate");
      expect.fail("expected transition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).status).toBe("cancelled");
      expect((error as InvalidTransitionError).event).toBe("activate");
    }
  });
});
