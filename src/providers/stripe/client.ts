import Stripe from "stripe";

/** Pinned so a Stripe API upgrade cannot silently change event/object shapes under us. */
export const STRIPE_API_VERSION = "2025-08-27.basil" satisfies Stripe.StripeConfig["apiVersion"];

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}
