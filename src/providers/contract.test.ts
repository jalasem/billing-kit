import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fake";
import { PaystackProvider } from "./paystack/adapter";
import { PaystackClient } from "./paystack/client";
import { StripeProvider } from "./stripe/adapter";
import type { NormalisedEvent, PaymentProvider } from "./types";

function fixture(...segments: string[]): string {
  return readFileSync(path.join(__dirname, ...segments), "utf-8");
}

const STRIPE_WEBHOOK_SECRET = "whsec_contract_test_secret";
const PAYSTACK_SECRET_KEY = "sk_contract_test_secret";

function stripeHeaders(rawBody: string, secret = STRIPE_WEBHOOK_SECRET): Headers {
  const header = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret });
  return new Headers({ "stripe-signature": header });
}

function paystackHeaders(rawBody: string, secret = PAYSTACK_SECRET_KEY): Headers {
  const signature = createHmac("sha512", secret).update(rawBody).digest("hex");
  return new Headers({ "x-paystack-signature": signature });
}

interface ProviderCase {
  name: string;
  provider: PaymentProvider;
  rawBody: string;
  validHeaders: Headers;
  tamperedHeaders: Headers;
  /** What `parseEvents(rawBody)` should produce for this fixture. */
  expected: Pick<Extract<NormalisedEvent, { type: "payment.succeeded" }>, "type" | "providerRef">;
}

function buildCases(): ProviderCase[] {
  const fakeProvider = new FakeProvider();
  const fakeEvent: NormalisedEvent = {
    type: "payment.succeeded",
    providerEventId: "evt_fake_1",
    providerRef: "ch_fake_contract_1",
    money: { amount: 100000n, currency: "NGN" },
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    raw: {},
  };
  const fakeSigned = fakeProvider.signedWebhook(fakeEvent);
  const fakeTampered = fakeProvider.signedWebhook({ ...fakeEvent, providerRef: "ch_tampered" });

  const stripeRawBody = fixture("stripe", "fixtures", "checkout-session-completed.json");
  const stripeProvider = new StripeProvider({ secretKey: "sk_test_contract", webhookSecret: STRIPE_WEBHOOK_SECRET });

  const paystackRawBody = fixture("paystack", "fixtures", "charge-success.json");
  const paystackProvider = new PaystackProvider({
    secretKey: PAYSTACK_SECRET_KEY,
    client: new PaystackClient(PAYSTACK_SECRET_KEY),
  });

  return [
    {
      name: "fake",
      provider: fakeProvider,
      rawBody: fakeSigned.rawBody,
      validHeaders: fakeSigned.headers,
      tamperedHeaders: fakeTampered.headers,
      expected: { type: "payment.succeeded", providerRef: "ch_fake_contract_1" },
    },
    {
      name: "stripe",
      provider: stripeProvider,
      rawBody: stripeRawBody,
      validHeaders: stripeHeaders(stripeRawBody),
      tamperedHeaders: stripeHeaders(stripeRawBody, "whsec_wrong_secret"),
      expected: { type: "payment.succeeded", providerRef: "pi_3PQRstAbCdEf" },
    },
    {
      name: "paystack",
      provider: paystackProvider,
      rawBody: paystackRawBody,
      validHeaders: paystackHeaders(paystackRawBody),
      tamperedHeaders: paystackHeaders(paystackRawBody, "sk_wrong_secret"),
      expected: { type: "payment.succeeded", providerRef: "qTPrJoy9Bx" },
    },
  ];
}

describe.each(buildCases())("provider contract: $name", ({ provider, rawBody, validHeaders, tamperedHeaders, expected }) => {
  it("accepts a correctly signed webhook body", () => {
    expect(provider.verifyWebhookSignature(rawBody, validHeaders)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(provider.verifyWebhookSignature(rawBody, tamperedHeaders)).toBe(false);
  });

  it("rejects a request with no signature header at all", () => {
    expect(provider.verifyWebhookSignature(rawBody, new Headers())).toBe(false);
  });

  it("parses the fixture into the expected normalised event", () => {
    const [event] = provider.parseEvents(rawBody);
    expect(event).toBeDefined();
    expect(event.type).toBe(expected.type);
    if (event.type === "payment.succeeded") {
      expect(event.providerRef).toBe(expected.providerRef);
      expect(typeof event.money.amount).toBe("bigint");
      expect(event.occurredAt).toBeInstanceOf(Date);
    }
  });
});
