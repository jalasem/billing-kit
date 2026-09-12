import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { renewDueSubscriptions } from "@/core/billing/subscriptions/renew";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { dunningAttempts, invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { StripeProvider } from "@/providers/stripe/adapter";
import type { NormalisedEvent } from "@/providers/types";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { handlePaymentFailed } from "./payment-failed";
import { handlePaymentSucceeded } from "./payment-succeeded";

const fakeProvider = new FakeProvider();
const stripeProvider = new StripeProvider({ secretKey: "sk_test_stub", webhookSecret: "whsec_test_stub" });

function stripeFixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../../providers/stripe/fixtures", name), "utf-8");
}

beforeEach(async () => {
  await resetM3Tables(db);
});

/**
 * Builds a subscription + its (already correctly ledger-posted, `open`)
 * first invoice through the real services with the `fake` provider — never
 * a live call — then relabels both rows to `provider` and pins the
 * subscription's `providerSubscriptionId`, so the fixture-driven webhook
 * events below have something real to link against.
 */
async function seedLinkableSubscription(input: {
  provider: "stripe" | "fake";
  providerSubscriptionId: string;
  amount: bigint;
  now: Date;
}) {
  const plan = await seedPlan(db, fakeProvider, { amount: input.amount, currency: "USD" });
  const customer = await seedCustomer(db, { email: `link-${input.providerSubscriptionId}@example.com` });
  const { subscription, invoice } = await createSubscription(db, fakeProvider, {
    customerId: customer.id,
    planId: plan.id,
    startTrial: false,
    now: input.now,
  });

  await db
    .update(subscriptions)
    .set({ provider: input.provider, providerSubscriptionId: input.providerSubscriptionId })
    .where(eq(subscriptions.id, subscription.id));
  await db.update(invoices).set({ provider: input.provider }).where(eq(invoices.id, invoice!.id));

  return { subscription, invoice: invoice!, customer };
}

describe("provider-mode invoice linkage (item 4)", () => {
  it("links by subscription + period among several unlinked open invoices, picking the one whose period contains the event's", async () => {
    const jan = new Date("2026-01-01T00:00:00.000Z");
    const feb = new Date("2026-02-01T00:00:00.000Z");

    const { subscription, invoice: januaryInvoice } = await seedLinkableSubscription({
      provider: "fake",
      providerSubscriptionId: "sub_link_1",
      amount: 1000n,
      now: jan,
    });

    await renewDueSubscriptions(db, { fake: fakeProvider }, feb);
    const [februaryInvoice] = (await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id))).filter(
      (row) => row.periodStart.getTime() === feb.getTime(),
    );
    expect(februaryInvoice.status).toBe("open");
    expect(februaryInvoice.providerRef).toBeNull();

    const event: Extract<NormalisedEvent, { type: "payment.succeeded" }> = {
      type: "payment.succeeded",
      providerEventId: "evt_link_1",
      providerRef: "pi_link_1",
      providerSubscriptionId: "sub_link_1",
      periodStart: new Date("2026-02-15T00:00:00.000Z"),
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
      money: { amount: 1000n, currency: "USD" },
      occurredAt: new Date("2026-02-15T00:00:00.000Z"),
      raw: {},
    };

    await handlePaymentSucceeded(db, "fake", event);

    const [paidFebruary] = await db.select().from(invoices).where(eq(invoices.id, februaryInvoice.id));
    expect(paidFebruary.status).toBe("paid");
    expect(paidFebruary.providerRef).toBe("pi_link_1");

    const [untouchedJanuary] = await db.select().from(invoices).where(eq(invoices.id, januaryInvoice.id));
    expect(untouchedJanuary.status).toBe("open");
    expect(untouchedJanuary.providerRef).toBeNull();

    // January's invoice is still open and unpaid; February's just paid — receivable reflects only January's.
    expect(await getBalance(db, "receivable:USD")).toBe(1000n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(1000n);
  });

  it("links a real Stripe invoice.paid fixture back to a billing-kit invoice by subscription id", async () => {
    const { invoice } = await seedLinkableSubscription({
      provider: "stripe",
      providerSubscriptionId: "sub_1PQRstSub001",
      amount: 200000n,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(invoice.periodEnd.toISOString()).toBe("2025-02-01T00:00:00.000Z");

    const [event] = stripeProvider.parseEvents(stripeFixture("invoice-paid.json"));
    expect(event.type).toBe("payment.succeeded");

    await handlePaymentSucceeded(db, "stripe", event as Extract<NormalisedEvent, { type: "payment.succeeded" }>);

    const [paid] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(paid.status).toBe("paid");
    expect(paid.providerRef).toBe("pi_3PQRstInvoice001");
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
    expect(await getBalance(db, "cash:stripe:USD")).toBe(200000n - 6100n);
  });

  it("links a real Stripe invoice.payment_failed fixture and starts dunning", async () => {
    const { subscription, invoice } = await seedLinkableSubscription({
      provider: "stripe",
      providerSubscriptionId: "sub_1PQRstSub001",
      amount: 200000n,
      now: new Date("2025-01-01T00:00:00.000Z"),
    });

    const [event] = stripeProvider.parseEvents(stripeFixture("invoice-payment-failed.json"));
    expect(event.type).toBe("payment.failed");

    await handlePaymentFailed(db, "stripe", event as Extract<NormalisedEvent, { type: "payment.failed" }>);

    const [linked] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(linked.providerRef).toBe("in_1PQRstInv002");

    const [updatedSubscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(updatedSubscription.status).toBe("past_due");

    const attempts = await db.select().from(dunningAttempts).where(eq(dunningAttempts.invoiceId, invoice.id));
    expect(attempts.length).toBeGreaterThan(0);
  });
});
