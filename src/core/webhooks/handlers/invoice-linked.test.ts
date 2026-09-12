import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { dunningAttempts, invoices, payments, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import type { NormalisedEvent } from "@/providers/types";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { renewDueSubscriptions } from "@/core/billing/subscriptions/renew";
import { handlePaymentFailed } from "./payment-failed";
import { handlePaymentSucceeded } from "./payment-succeeded";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("M2 payment webhook handlers: invoice-linked payments (M3 resolution)", () => {
  it("payment.succeeded matching an open invoice's provider_ref posts against receivable and marks it paid, instead of the one-off cash/revenue posting", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 800n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "invoice-webhook-1@example.com" });
    const { invoice } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(invoice!.status).toBe("open");

    // Simulate the provider having been given `inv_{id}` as the checkout
    // reference: its ref is already on the invoice, as `attemptInvoicePayment` would set it.
    await db.update(invoices).set({ providerRef: "pi_test_1" }).where(eq(invoices.id, invoice!.id));

    const event: Extract<NormalisedEvent, { type: "payment.succeeded" }> = {
      type: "payment.succeeded",
      providerEventId: "evt_1",
      providerRef: "pi_test_1",
      money: { amount: 800n, currency: "USD" },
      occurredAt: new Date("2026-01-01T00:05:00.000Z"),
      raw: {},
    };

    await handlePaymentSucceeded(db, "fake", event);

    const [paidInvoice] = await db.select().from(invoices).where(eq(invoices.id, invoice!.id));
    expect(paidInvoice.status).toBe("paid");
    expect(paidInvoice.total).toBe(800n);

    expect(await getBalance(db, "receivable:USD")).toBe(0n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(800n);
    expect(await getBalance(db, "revenue:USD")).toBe(-800n);

    const [paymentRow] = await db.select().from(payments).where(eq(payments.providerRef, "pi_test_1"));
    expect(paymentRow.status).toBe("succeeded");

    // Replaying the same event changes nothing further.
    await handlePaymentSucceeded(db, "fake", event);
    expect(await getBalance(db, "cash:fake:USD")).toBe(800n);
    const rows = await db.select().from(payments).where(eq(payments.providerRef, "pi_test_1"));
    expect(rows).toHaveLength(1);
  });

  it("payment.failed matching an open invoice starts dunning: subscription -> past_due, attempts scheduled", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "invoice-webhook-2@example.com" });
    const { subscription, invoice } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db.update(invoices).set({ providerRef: "pi_test_2" }).where(eq(invoices.id, invoice!.id));

    const event: Extract<NormalisedEvent, { type: "payment.failed" }> = {
      type: "payment.failed",
      providerEventId: "evt_2",
      providerRef: "pi_test_2",
      money: { amount: 500n, currency: "USD" },
      occurredAt: new Date("2026-01-01T00:05:00.000Z"),
      raw: {},
    };

    await handlePaymentFailed(db, "fake", event);

    const [updated] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(updated.status).toBe("past_due");

    const attempts = await db.select().from(dunningAttempts).where(eq(dunningAttempts.invoiceId, invoice!.id));
    expect(attempts.length).toBeGreaterThan(0);
  });

  it("still applies the original one-off cash/revenue posting when the event does not match any open invoice", async () => {
    const event: Extract<NormalisedEvent, { type: "payment.succeeded" }> = {
      type: "payment.succeeded",
      providerEventId: "evt_3",
      providerRef: "pi_one_off",
      money: { amount: 300n, currency: "USD" },
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      raw: {},
    };

    await handlePaymentSucceeded(db, "fake", event);

    expect(await getBalance(db, "cash:fake:USD")).toBe(300n);
    expect(await getBalance(db, "revenue:USD")).toBe(-300n);
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
  });

  it("keeps the M2 replay-safety guarantee for a renewal invoice paid via webhook", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 400n, currency: "USD" });
    // A saved method so the first invoice auto-pays at creation, leaving
    // only the renewal invoice open for this test to pay via webhook.
    const customer = await seedCustomer(db, { email: "invoice-webhook-4@example.com", defaultAuthorization: "tok_visa" });
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription, invoice: firstInvoice } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: t0,
    });
    expect(firstInvoice!.status).toBe("paid");

    // The renewal's own kit-mode charge attempt fails, leaving the invoice
    // open (and dunning started) — this is exactly the situation a
    // provider's own out-of-band retry later resolves via webhook.
    const t1 = new Date("2026-02-01T00:00:00.000Z");
    fakeProvider.scriptChargeOutcomes(["failed"]);
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1);

    const [renewalInvoice] = (await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id))).filter(
      (row) => row.periodStart.getTime() === t1.getTime(),
    );
    expect(renewalInvoice.status).toBe("open");
    await db.update(invoices).set({ providerRef: "pi_renewal" }).where(eq(invoices.id, renewalInvoice.id));

    const event: Extract<NormalisedEvent, { type: "payment.succeeded" }> = {
      type: "payment.succeeded",
      providerEventId: "evt_4",
      providerRef: "pi_renewal",
      money: { amount: 400n, currency: "USD" },
      occurredAt: t1,
      raw: {},
    };

    await handlePaymentSucceeded(db, "fake", event);
    await handlePaymentSucceeded(db, "fake", event);

    const [paid] = await db.select().from(invoices).where(eq(invoices.id, renewalInvoice.id));
    expect(paid.status).toBe("paid");
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
  });
});
