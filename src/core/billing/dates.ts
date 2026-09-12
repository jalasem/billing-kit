const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days between two instants, using UTC day boundaries so a
 * period's day count doesn't depend on the server's local timezone or DST.
 * Callers only ever pass exact period boundaries (never in-day instants),
 * so this is exact for every date this codebase produces.
 */
export function daysBetween(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Adds `count` billing intervals to `date`. Calendar-based (not fixed
 * 30/365-day windows), so "monthly from Jan 31" lands on the last day of
 * the next month via JS `Date`'s own month-overflow rollover (Feb 31 ->
 * Mar 2/3), the same behaviour Stripe's own period math has at that edge.
 */
export function addInterval(date: Date, interval: "month" | "year", count: number): Date {
  const result = new Date(date.getTime());
  if (interval === "month") {
    result.setUTCMonth(result.getUTCMonth() + count);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + count);
  }
  return result;
}
