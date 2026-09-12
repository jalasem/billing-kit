import { describe, expect, it } from "vitest";
import { prorate } from "./proration";

describe("prorate (daily, period_start inclusive / period_end exclusive)", () => {
  // Worked example from the M3 report: a 31-day period (Jan 1 inclusive to
  // Feb 1 exclusive), a plan change on day 11 (10 days used, 21 remaining),
  // old plan $10.00/mo -> new plan $20.00/mo, both in cents.
  const periodStart = new Date("2026-01-01T00:00:00.000Z");
  const periodEnd = new Date("2026-02-01T00:00:00.000Z");
  const changeAt = new Date("2026-01-11T00:00:00.000Z");

  it("computes the documented worked example exactly", () => {
    const result = prorate({
      periodStart,
      periodEnd,
      changeAt,
      oldPlanAmount: 1000n,
      newPlanAmount: 2000n,
    });

    expect(result.totalDays).toBe(31);
    expect(result.daysUsed).toBe(10);
    expect(result.daysRemaining).toBe(21);
    // 1000 / 31 = 32 per day (floor), remainder 8 on the last day.
    // Unused = days 10..30 (21 days) = 20*32 + (32+8) = 640 + 40 = 680.
    expect(result.unusedCreditOldPlan).toBe(680n);
    // 2000 / 31 = 64 per day (floor), remainder 16 on the last day.
    // Charge = 20*64 + (64+16) = 1280 + 80 = 1360.
    expect(result.chargeNewPlan).toBe(1360n);
    expect(result.delta).toBe(680n);
  });

  it("never loses or gains a minor unit to rounding: the daily amounts for a full period sum to the plan amount", () => {
    // Proven indirectly: unused (days 10-30) + used-equivalent (days 0-9,
    // recomputed by symmetry) must equal the plan's full amount. Assert it
    // directly by prorating from day 0 (all 31 days "remaining").
    const fromStart = prorate({
      periodStart,
      periodEnd,
      changeAt: periodStart,
      oldPlanAmount: 1000n,
      newPlanAmount: 2000n,
    });
    expect(fromStart.unusedCreditOldPlan).toBe(1000n);
    expect(fromStart.chargeNewPlan).toBe(2000n);
    expect(fromStart.delta).toBe(1000n);
  });

  it("prorates to zero delta when the new plan costs the same as the old one", () => {
    const result = prorate({ periodStart, periodEnd, changeAt, oldPlanAmount: 1500n, newPlanAmount: 1500n });
    expect(result.delta).toBe(0n);
  });

  it("prorates to a negative delta (credit) when downgrading", () => {
    const result = prorate({ periodStart, periodEnd, changeAt, oldPlanAmount: 2000n, newPlanAmount: 1000n });
    expect(result.delta).toBeLessThan(0n);
  });

  it("rejects a change at or after periodEnd", () => {
    expect(() =>
      prorate({ periodStart, periodEnd, changeAt: periodEnd, oldPlanAmount: 1000n, newPlanAmount: 2000n }),
    ).toThrow();
  });

  it("rejects a change before periodStart", () => {
    const before = new Date("2025-12-31T00:00:00.000Z");
    expect(() => prorate({ periodStart, periodEnd, changeAt: before, oldPlanAmount: 1000n, newPlanAmount: 2000n })).toThrow();
  });
});
