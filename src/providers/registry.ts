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

/** Whether `createProvider(id)` has what it needs from the environment without throwing. `fake` needs nothing. */
export function isProviderConfigured(id: ProviderId): boolean {
  switch (id) {
    case "stripe":
      return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
    case "paystack":
      return Boolean(process.env.PAYSTACK_SECRET_KEY);
    case "fake":
      return true;
  }
}

/**
 * The live provider ids (`stripe`, `paystack`) that are actually
 * configured in this environment. Jobs that run against every live
 * provider (dunning, renewal, reconciliation) use this instead of always
 * building both, so a deployment that only has Paystack keys set doesn't
 * crash the job the moment it also tries to build a Stripe client.
 */
export function configuredProviders(): ProviderId[] {
  return (["stripe", "paystack"] as const).filter(isProviderConfigured);
}

/**
 * Chooses the provider the portal's "Subscribe" action bills a brand new
 * subscription against: the `fake` provider outside production (documented
 * — there is no real payment step to complete locally or in CI), otherwise
 * the first configured live provider. Throws if none is configured, which
 * is a deployment misconfiguration the operator needs to fix.
 */
export function defaultProviderForNewSubscriptions(): PaymentProvider {
  if (process.env.NODE_ENV !== "production") {
    return createProvider("fake");
  }
  const [first] = configuredProviders();
  if (!first) {
    throw new Error("No payment provider is configured (STRIPE_SECRET_KEY/PAYSTACK_SECRET_KEY)");
  }
  return createProvider(first);
}

/**
 * Builds a `{ stripe?, paystack? }` map of live providers, skipping (and
 * logging) any that aren't configured, instead of the caller building both
 * unconditionally and crashing on the first missing env var. Shared by the
 * dunning, renewal, and reconciliation jobs/routes.
 */
export function buildLiveProviders(logLabel: string): Partial<Record<ProviderId, PaymentProvider>> {
  const providers: Partial<Record<ProviderId, PaymentProvider>> = {};
  for (const id of ["stripe", "paystack"] as const) {
    if (isProviderConfigured(id)) {
      providers[id] = createProvider(id);
    } else {
      console.log(`[${logLabel}] skipping ${id}: not configured`);
    }
  }
  return providers;
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
