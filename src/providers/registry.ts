import { FakeProvider } from "./fake";
import { PaystackProvider } from "./paystack/adapter";
import { StripeProvider } from "./stripe/adapter";
import type { PaymentProvider, ProviderId } from "./types";

export function isProviderId(value: string): value is ProviderId {
  return value === "stripe" || value === "paystack" || value === "fake";
}

let sharedFakeProvider: FakeProvider | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Builds a live provider from environment variables. `fake` returns a
 * shared, process-lifetime instance so its in-memory state (customers,
 * subscriptions) is consistent across calls within one process, matching
 * how a real provider's state would be.
 */
export function createProvider(id: ProviderId): PaymentProvider {
  switch (id) {
    case "stripe":
      return new StripeProvider({
        secretKey: requireEnv("STRIPE_SECRET_KEY"),
        webhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
      });
    case "paystack":
      return new PaystackProvider({ secretKey: requireEnv("PAYSTACK_SECRET_KEY") });
    case "fake":
      sharedFakeProvider ??= new FakeProvider();
      return sharedFakeProvider;
  }
}
