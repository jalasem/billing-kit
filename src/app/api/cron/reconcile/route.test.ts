import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { FakeProvider } from "@/providers/fake";
import { resetBillingTables } from "@/test/reset-db";

// `route.ts` builds its providers via `buildLiveProviders`, which (for a
// real, unconfigured provider) needs real Stripe/Paystack env vars and,
// once built, would make a live `listSettlements` call. `buildLiveProviders`
// calls `createProvider` internally as a same-module reference, so mocking
// only `createProvider` doesn't reach it — `buildLiveProviders` itself is
// mocked here instead, still delegating to the real (unmocked)
// `configuredProviders()` so the "skips an unconfigured provider" behaviour
// under test is real, while the provider each configured id maps to is
// always the in-memory fake.
vi.mock("@/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/registry")>();
  return {
    ...actual,
    buildLiveProviders: () => {
      const providers: Record<string, FakeProvider> = {};
      for (const id of actual.configuredProviders()) {
        providers[id] = new FakeProvider();
      }
      return providers;
    },
  };
});

const { POST } = await import("./route");

const ORIGINAL_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
};

beforeEach(async () => {
  await resetBillingTables(db);
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/reconcile", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/cron/reconcile", () => {
  it("returns 401 when CRON_SECRET is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(request("Bearer anything"));
    expect(response.status).toBe(401);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("returns 401 for the wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("returns 200 with summaries for every configured provider, never touching a live provider", async () => {
    process.env.CRON_SECRET = "correct-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.summaries).toHaveProperty("stripe");
    expect(body.summaries).toHaveProperty("paystack");
  });

  it("skips an unconfigured provider instead of crashing", async () => {
    process.env.CRON_SECRET = "correct-secret";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summaries).not.toHaveProperty("stripe");
    expect(body.summaries).toHaveProperty("paystack");
  });
});
