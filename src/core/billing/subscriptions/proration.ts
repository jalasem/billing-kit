import { daysBetween } from "../dates";

export interface ProrationInput {
  /** Inclusive. */
  periodStart: Date;
  /** Exclusive — see the policy note below. */
  periodEnd: Date;
  changeAt: Date;
  oldPlanAmount: bigint;
  newPlanAmount: bigint;
}

export interface ProrationResult {
  totalDays: number;
  daysUsed: number;
  daysRemaining: number;
  /** Positive: credit for the unused portion of the old plan. */
  unusedCreditOldPlan: bigint;
  /** Positive: charge for the remaining portion of the new plan. */
  chargeNewPlan: bigint;
  /** `chargeNewPlan - unusedCreditOldPlan`. Positive owes money (open invoice); negative is a customer credit. */
  delta: bigint;
}

/**
 * Daily proration policy: **period_start is inclusive, period_end is
 * exclusive** — a period from Jan 1 to Feb 1 has exactly 31 days (Jan 1
 * through Jan 31), and a change on Jan 11 has used 10 of them. Both plans'
 * amounts are amortised over the *same* `totalDays` (the current period's
 * length), one day at a time: `amount / totalDays`, floored, with the
 * integer remainder added to the period's last day. That keeps each plan's
 * per-day amounts summing to exactly its full-period amount (never a cent
 * more or less through rounding), and both plans use an identical basis so
 * a plan swap with no price difference prorates to a zero delta.
 */
export function prorate(input: ProrationInput): ProrationResult {
  const totalDays = daysBetween(input.periodStart, input.periodEnd);
  const daysUsed = daysBetween(input.periodStart, input.changeAt);
  const daysRemaining = totalDays - daysUsed;

  if (totalDays <= 0) {
    throw new Error("periodEnd must be after periodStart");
  }
  if (daysUsed < 0 || daysRemaining <= 0) {
    throw new Error("changeAt must fall on or after periodStart and strictly before periodEnd");
  }

  const oldDaily = dailyAmounts(input.oldPlanAmount, totalDays);
  const newDaily = dailyAmounts(input.newPlanAmount, totalDays);

  const unusedCreditOldPlan = sumFrom(oldDaily, daysUsed);
  const chargeNewPlan = sumFrom(newDaily, daysUsed);

  return {
    totalDays,
    daysUsed,
    daysRemaining,
    unusedCreditOldPlan,
    chargeNewPlan,
    delta: chargeNewPlan - unusedCreditOldPlan,
  };
}

/** `totalAmount` split into `totalDays` integer amounts that sum back to exactly `totalAmount`; the rounding remainder lands on the last day. */
function dailyAmounts(totalAmount: bigint, totalDays: number): bigint[] {
  const days = BigInt(totalDays);
  const perDay = totalAmount / days;
  const remainder = totalAmount - perDay * days;
  const amounts = new Array<bigint>(totalDays).fill(perDay);
  amounts[totalDays - 1] += remainder;
  return amounts;
}

function sumFrom(amounts: bigint[], fromIndex: number): bigint {
  return amounts.slice(fromIndex).reduce((total, amount) => total + amount, 0n);
}
