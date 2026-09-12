import type { Customer } from "@/db/schema";
import type { ProviderId } from "@/providers/types";

/**
 * `customer.dunning_mode` overrides the per-provider default when set.
 * Otherwise: Stripe's own subscriptions retry and emit
 * `invoice.payment_failed` / `invoice.paid` themselves ("provider" mode);
 * Paystack (and the `fake` provider, so tests can drive the full kit-mode
 * retry flow deterministically) have no built-in retry, so the kit retries
 * itself via `chargeSavedMethod` ("kit" mode).
 */
export function dunningModeFor(customer: Pick<Customer, "dunningMode">, provider: ProviderId): "provider" | "kit" {
  if (customer.dunningMode) {
    return customer.dunningMode;
  }
  return provider === "stripe" ? "provider" : "kit";
}
