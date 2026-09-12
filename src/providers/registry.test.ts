import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveProviders, configuredProviders, isProviderConfigured } from "./registry";

vi.mock("./stripe/adapter", () => ({ StripeProvider: class {} }));
vi.mock("./paystack/adapter", () => ({ PaystackProvider: class {} }));

const ORIGINAL_ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("isProviderConfigured / configuredProviders", () => {
  it("fake is always configured", () => {
    expect(isProviderConfigured("fake")).toBe(true);
  });

  it("stripe needs both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(isProviderConfigured("stripe")).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test";
    expect(isProviderConfigured("stripe")).toBe(false);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    expect(isProviderConfigured("stripe")).toBe(true);
  });

  it("paystack needs PAYSTACK_SECRET_KEY", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(isProviderConfigured("paystack")).toBe(false);
    process.env.PAYSTACK_SECRET_KEY = "sk_test";
    expect(isProviderConfigured("paystack")).toBe(true);
  });

  it("configuredProviders lists only the ones with env vars set", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = "sk_test";
    expect(configuredProviders()).toEqual(["paystack"]);
  });
});

describe("buildLiveProviders", () => {
  it("skips an unconfigured provider instead of throwing, logging a line for it", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = "sk_test";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const providers = buildLiveProviders("test-job");
    logSpy.mockRestore();

    expect(providers.stripe).toBeUndefined();
    expect(providers.paystack).toBeDefined();
  });

  it("returns an empty map when nothing is configured", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.PAYSTACK_SECRET_KEY;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const providers = buildLiveProviders("test-job");
    logSpy.mockRestore();

    expect(providers).toEqual({});
  });
});
