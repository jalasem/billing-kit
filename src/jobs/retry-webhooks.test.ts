import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ledgerModule from "@/core/ledger";
import { handleWebhookRequest } from "@/core/webhooks";
import { MAX_INGEST_ATTEMPTS } from "@/core/webhooks/ingest-event";
import { db } from "@/db/client";
import { entries, payments, webhookEvents } from "@/db/schema";
import { StripeProvider } from "@/providers/stripe/adapter";
import { resetBillingTables } from "@/test/reset-db";
import { retryFailedWebhooks } from "./retry-webhooks";

function stripeFixture(name: string): string {
  return readFileSync(path.join(__dirname, "../providers/stripe/fixtures", name), "utf-8");
}

const STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
const stripeProvider = new StripeProvider({ secretKey: "sk_test_stub", webhookSecret: STRIPE_WEBHOOK_SECRET });

function stripeHeaders(rawBody: string): Headers {
  return new Headers({
    "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: STRIPE_WEBHOOK_SECRET }),
  });
}

beforeEach(async () => {
  await resetBillingTables(db);
});

describe("retryFailedWebhooks", () => {
  it("re-processes an event whose handler failed once, posting exactly one ledger entry", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const headers = stripeHeaders(rawBody);

    const spy = vi
      .spyOn(ledgerModule, "ensureChartOfAccounts")
      .mockImplementationOnce(() => Promise.reject(new Error("simulated transient failure")));

    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);

    const [beforeRetry] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, "evt_1PQRstCheckoutCompleted"));
    expect(beforeRetry.processedAt).toBeNull();
    expect(beforeRetry.attempts).toBe(1);

    spy.mockRestore();

    const summary = await retryFailedWebhooks(db);
    expect(summary).toEqual({ attempted: 1, succeeded: 1, stillFailing: 0 });

    const [afterRetry] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, "evt_1PQRstCheckoutCompleted"));
    expect(afterRetry.processedAt).not.toBeNull();
    expect(afterRetry.error).toBeNull();

    const paymentRows = await db.select().from(payments).where(eq(payments.providerRef, "pi_3PQRstAbCdEf"));
    expect(paymentRows).toHaveLength(1);

    const entryRows = await db
      .select()
      .from(entries)
      .where(eq(entries.idempotencyKey, "payment:stripe:pi_3PQRstAbCdEf"));
    expect(entryRows).toHaveLength(1);
  });

  it("reports stillFailing and leaves processed_at NULL when the retry also fails", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const headers = stripeHeaders(rawBody);

    const spy = vi
      .spyOn(ledgerModule, "ensureChartOfAccounts")
      .mockImplementation(() => Promise.reject(new Error("still broken")));

    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);
    const summary = await retryFailedWebhooks(db);

    expect(summary).toEqual({ attempted: 1, succeeded: 0, stillFailing: 1 });

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, "evt_1PQRstCheckoutCompleted"));
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(2);

    spy.mockRestore();
  });

  it("does not retry an already-processed event", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody));

    const summary = await retryFailedWebhooks(db);
    expect(summary).toEqual({ attempted: 0, succeeded: 0, stillFailing: 0 });
  });

  it("does not retry an unmapped event (nothing to retry: empty payload)", async () => {
    const rawBody = stripeFixture("customer-created-unhandled.json");
    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, stripeHeaders(rawBody));

    const summary = await retryFailedWebhooks(db);
    expect(summary).toEqual({ attempted: 0, succeeded: 0, stillFailing: 0 });
  });

  it("does not retry an event that has exhausted MAX_INGEST_ATTEMPTS", async () => {
    const rawBody = stripeFixture("checkout-session-completed.json");
    const headers = stripeHeaders(rawBody);

    const spy = vi
      .spyOn(ledgerModule, "ensureChartOfAccounts")
      .mockImplementation(() => Promise.reject(new Error("always fails")));

    // First delivery inserts the row and fails once (attempts -> 1).
    await handleWebhookRequest(db, stripeProvider, "stripe", rawBody, headers);
    // Drive it up to MAX_INGEST_ATTEMPTS via the retry job.
    for (let i = 1; i < MAX_INGEST_ATTEMPTS; i += 1) {
      await retryFailedWebhooks(db);
    }

    const [exhausted] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, "evt_1PQRstCheckoutCompleted"));
    expect(exhausted.attempts).toBe(MAX_INGEST_ATTEMPTS);

    const summary = await retryFailedWebhooks(db);
    expect(summary).toEqual({ attempted: 0, succeeded: 0, stillFailing: 0 });

    spy.mockRestore();
  });
});
