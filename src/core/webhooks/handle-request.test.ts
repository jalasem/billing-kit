import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { payments, settlements, webhookEvents } from "@/db/schema";
import { PaystackProvider } from "@/providers/paystack/adapter";
import { StripeProvider } from "@/providers/stripe/adapter";
import { resetBillingTables } from "@/test/reset-db";
import { handleWebhookRequest } from "./handle-request";

const STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
const PAYSTACK_SECRET_KEY = "sk_test_secret";

function stripeFixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../providers/stripe/fixtures", name), "utf-8");
}

function paystackFixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../providers/paystack/fixtures", name), "utf-8");
}

function stripeHeaders(rawBody: string, secret = STRIPE_WEBHOOK_SECRET): Headers {
  return new Headers({ "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret }) });
}

async function paystackHeaders(rawBody: string, secret = PAYSTACK_SECRET_KEY): Promise<Headers> {
  const { createHmac } = await import("node:crypto");
  return new Headers({ "x-paystack-signature": createHmac("sha512", secret).update(rawBody).digest("hex") });
}

const stripeProvider = new StripeProvider({ secretKey: "sk_test_stub", webhookSecret: STRIPE_WEBHOOK_SECRET });
const paystackProvider = new PaystackProvider({ secretKey: PAYSTACK_SECRET_KEY });

beforeEach(async () => {
  await resetBillingTables(db);
});

describe("Stripe webhook ingestion", () => {
  it("lands checkout.session.completed as one payment with correct postings and balances", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody));

    expect(outcome.status).toBe(200);

    const rows = await db.select().from(payments).where(eq(payments.providerRef, "pi_3PQRstAbCdEf"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "stripe",
      status: "succeeded",
      amount: 500000n,
      fee: 14800n,
      currency: "USD",
    });

    expect(await getBalance(db, "cash:stripe:USD")).toBe(500000n - 14800n);
    expect(await getBalance(db, "revenue:USD")).toBe(-500000n);
    expect(await getBalance(db, "fees:stripe:USD")).toBe(14800n);
  });

  it("replaying the same webhook body changes nothing", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const headers = stripeHeaders(rawBody);

    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);

    expect(outcome.status).toBe(200);
    if (outcome.status === 200 && "results" in outcome.body) {
      expect(outcome.body.results[0]?.duplicate).toBe(true);
    }

    const rows = await db.select().from(payments).where(eq(payments.providerRef, "pi_3PQRstAbCdEf"));
    expect(rows).toHaveLength(1);
    expect(await getBalance(db, "cash:stripe:USD")).toBe(500000n - 14800n);
  });

  it("returns 400 for a tampered signature and records nothing", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody, "whsec_wrong"));

    expect(outcome.status).toBe(400);
    const rows = await db.select().from(payments);
    expect(rows).toHaveLength(0);
  });

  it("records and ignores an event type it does not map", async () => {
    const rawBody = stripeFixture("customer-created-unhandled.json");
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody));

    expect(outcome.status).toBe(200);
    if (outcome.status === 200 && "ignored" in outcome.body) {
      expect(outcome.body.ignored).toBe(true);
    }

    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, "evt_1PQRstCustomerCreated"));
    expect(event).toMatchObject({ provider: "stripe", type: "customer.created" });
    expect(event.processedAt).not.toBeNull();
  });

  it("posts a refund against the original payment and marks it refunded once fully refunded", async () => {
    const paymentBody = stripeFixture("checkout-session-completed.json");
    await handleWebhookRequest(db, stripeProvider, "stripe", paymentBody, stripeHeaders(paymentBody));

    const refundBody = stripeFixture("charge-refunded.json");
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", refundBody, stripeHeaders(refundBody));
    expect(outcome.status).toBe(200);

    const [payment] = await db.select().from(payments).where(eq(payments.providerRef, "pi_3PQRstAbCdEf"));
    expect(payment.status).toBe("refunded");
    expect(await getBalance(db, "refunds:USD")).toBe(500000n);
    expect(await getBalance(db, "cash:stripe:USD")).toBe(500000n - 14800n - 500000n);
  });

  it("posts a settlement idempotently for payout.paid", async () => {
    const rawBody = stripeFixture("payout-paid.json");
    const headers = stripeHeaders(rawBody);

    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);
    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);

    const rows = await db.select().from(settlements).where(eq(settlements.settlementId, "po_3PQRstPayout001"));
    expect(rows).toHaveLength(1);
  });

  it("records subscription.updated without posting to the ledger", async () => {
    const rawBody = stripeFixture("subscription-updated.json");
    const outcome = await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody));

    expect(outcome.status).toBe(200);
    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, "evt_1PQRstSubUpdated"));
    expect(event.processedAt).not.toBeNull();
    expect(event.error).toBeNull();
  });
});

describe("Paystack webhook ingestion", () => {
  it("lands charge.success as one payment with correct postings and balances", async () => {
    const rawBody = paystackFixture("charge-success.json");
    const outcome = await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, await paystackHeaders(rawBody));

    expect(outcome.status).toBe(200);

    const rows = await db.select().from(payments).where(eq(payments.providerRef, "qTPrJoy9Bx"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "paystack",
      status: "succeeded",
      amount: 1000000n,
      fee: 15000n,
      currency: "NGN",
    });

    expect(await getBalance(db, "cash:paystack:NGN")).toBe(1000000n - 15000n);
    expect(await getBalance(db, "revenue:NGN")).toBe(-1000000n);
    expect(await getBalance(db, "fees:paystack:NGN")).toBe(15000n);
  });

  it("replaying the same webhook body changes nothing", async () => {
    const rawBody = paystackFixture("charge-success.json");
    const headers = await paystackHeaders(rawBody);

    await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, headers);
    await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, headers);

    const rows = await db.select().from(payments).where(eq(payments.providerRef, "qTPrJoy9Bx"));
    expect(rows).toHaveLength(1);
    expect(await getBalance(db, "cash:paystack:NGN")).toBe(1000000n - 15000n);
  });

  it("returns 400 for a tampered signature and records nothing", async () => {
    const rawBody = paystackFixture("charge-success.json");
    const outcome = await handleWebhookRequest(
      db,
      paystackProvider,
      "paystack",
      rawBody,
      await paystackHeaders(rawBody, "sk_wrong"),
    );

    expect(outcome.status).toBe(400);
    const rows = await db.select().from(payments);
    expect(rows).toHaveLength(0);
  });

  it("records and ignores an event type it does not map", async () => {
    const rawBody = paystackFixture("customer-identification-unhandled.json");
    const outcome = await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, await paystackHeaders(rawBody));

    expect(outcome.status).toBe(200);
    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.type, "customeridentification.success"));
    expect(event).toMatchObject({ provider: "paystack" });
    expect(event.processedAt).not.toBeNull();
  });

  it("posts a refund against the original payment and marks it refunded once fully refunded", async () => {
    const paymentBody = paystackFixture("charge-success.json");
    await handleWebhookRequest(db, paystackProvider, "paystack", paymentBody, await paystackHeaders(paymentBody));

    const refundBody = paystackFixture("refund-processed.json");
    const outcome = await handleWebhookRequest(
      db,
      paystackProvider,
      "paystack",
      refundBody,
      await paystackHeaders(refundBody),
    );
    expect(outcome.status).toBe(200);

    const [payment] = await db.select().from(payments).where(eq(payments.providerRef, "qTPrJoy9Bx"));
    expect(payment.status).toBe("refunded");
    expect(await getBalance(db, "refunds:NGN")).toBe(1000000n);
  });

  it("posts a settlement idempotently for transfer.success", async () => {
    const rawBody = paystackFixture("transfer-success.json");
    const headers = await paystackHeaders(rawBody);

    await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, headers);
    await handleWebhookRequest(db, paystackProvider, "paystack", rawBody, headers);

    const rows = await db.select().from(settlements).where(eq(settlements.settlementId, "TRF_1ptvuv321ahaa7q"));
    expect(rows).toHaveLength(1);
  });
});
