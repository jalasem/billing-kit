import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fake";
import { PaystackProvider } from "./paystack/adapter";
import { PaystackClient } from "./paystack/client";
import { StripeProvider } from "./stripe/adapter";
import type { NormalisedEvent, NormalisedEventType, PaymentProvider, ProviderId } from "./types";

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

const fakeProvider = new FakeProvider();
const stripeProvider = new StripeProvider({ secretKey: "sk_test_contract", webhookSecret: STRIPE_WEBHOOK_SECRET });
const paystackProvider = new PaystackProvider({
  secretKey: PAYSTACK_SECRET_KEY,
  client: new PaystackClient(PAYSTACK_SECRET_KEY),
});

interface SignatureCase {
  name: ProviderId;
  provider: PaymentProvider;
  rawBody: string;
  validHeaders: Headers;
  tamperedHeaders: Headers;
  /** What `parseEvents(rawBody)` should produce for this fixture. */
  expected: Pick<Extract<NormalisedEvent, { type: "payment.succeeded" }>, "type" | "providerRef">;
}

function buildSignatureCases(): SignatureCase[] {
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
  const paystackRawBody = fixture("paystack", "fixtures", "charge-success.json");

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

describe.each(buildSignatureCases())(
  "provider contract: $name signature",
  ({ provider, rawBody, validHeaders, tamperedHeaders, expected }) => {
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
  },
);

/** One raw body per `NormalisedEvent` type, per provider — every provider must be able to emit all five. */
interface EventTypeCase {
  provider: ProviderId;
  type: NormalisedEventType;
  rawBody: string;
}

function fakeEventOfType(type: NormalisedEventType): NormalisedEvent {
  const base = { providerEventId: `evt_fake_${type}`, occurredAt: new Date("2026-01-01T00:00:00.000Z"), raw: {} };
  switch (type) {
    case "payment.succeeded":
      return { ...base, type, providerRef: "ch_fake_1", money: { amount: 1000n, currency: "NGN" } };
    case "payment.failed":
      return { ...base, type, providerRef: "ch_fake_2", money: { amount: 1000n, currency: "NGN" } };
    case "refund.succeeded":
      return { ...base, type, providerRef: "rf_fake_1", paymentRef: "ch_fake_1", money: { amount: 500n, currency: "NGN" } };
    case "subscription.updated":
      return { ...base, type, providerSubscriptionId: "sub_fake_1", status: "active" };
    case "settlement.posted":
      return {
        ...base,
        type,
        settlementId: "stl_fake_1",
        money: { amount: 1000n, currency: "NGN" },
        fee: { amount: 0n, currency: "NGN" },
      };
  }
}

function buildEventTypeCases(): EventTypeCase[] {
  const eventTypes: NormalisedEventType[] = [
    "payment.succeeded",
    "payment.failed",
    "refund.succeeded",
    "subscription.updated",
    "settlement.posted",
  ];

  const fakeCases = eventTypes.map((type) => ({
    provider: "fake" as const,
    type,
    rawBody: fakeProvider.signedWebhook(fakeEventOfType(type)).rawBody,
  }));

  const stripeFixtures: Record<NormalisedEventType, string> = {
    "payment.succeeded": "checkout-session-completed.json",
    "payment.failed": "invoice-payment-failed.json",
    "refund.succeeded": "charge-refunded.json",
    "subscription.updated": "subscription-updated.json",
    "settlement.posted": "payout-paid.json",
  };
  const stripeCases = eventTypes.map((type) => ({
    provider: "stripe" as const,
    type,
    rawBody: fixture("stripe", "fixtures", stripeFixtures[type]),
  }));

  const paystackFixtures: Record<NormalisedEventType, string> = {
    "payment.succeeded": "charge-success.json",
    "payment.failed": "invoice-payment-failed.json",
    "refund.succeeded": "refund-processed.json",
    "subscription.updated": "subscription-create.json",
    "settlement.posted": "transfer-success.json",
  };
  const paystackCases = eventTypes.map((type) => ({
    provider: "paystack" as const,
    type,
    rawBody: fixture("paystack", "fixtures", paystackFixtures[type]),
  }));

  return [...fakeCases, ...stripeCases, ...paystackCases];
}

const providerInstances: Record<ProviderId, PaymentProvider> = {
  fake: fakeProvider,
  stripe: stripeProvider,
  paystack: paystackProvider,
};

describe.each(buildEventTypeCases())("provider contract: $provider emits $type", ({ provider, type, rawBody }) => {
  it("parses into a normalised event of the expected type", () => {
    const [event] = providerInstances[provider].parseEvents(rawBody);
    expect(event).toBeDefined();
    expect(event.type).toBe(type);
    expect(event.providerEventId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
  });
});
