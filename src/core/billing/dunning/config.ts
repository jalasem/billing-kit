/**
 * Days after a payment failure that each kit-mode retry attempt is
 * scheduled for. `dunning_attempts.attempt_no` is 1-indexed and lines up
 * with this array's position (attempt 1 -> day 0, attempt 2 -> day 3, ...).
 */
export const DUNNING_SCHEDULE_DAYS: readonly number[] = [0, 3, 5, 7];

/** Days after the failure that `past_due` moves to `unpaid` once the retry schedule is exhausted with no recovery. */
export const DUNNING_GRACE_DAYS = 7;

/** Days after the failure that a still-unrecovered subscription is cancelled outright. */
export const DUNNING_CANCEL_AFTER_DAYS = 14;
