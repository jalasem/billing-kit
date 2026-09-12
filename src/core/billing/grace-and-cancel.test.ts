import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { runDunningJob } from "./dunning/run";
import { createSubscription } from "./subscriptions/create";
import { renewDueSubscriptions } from "./subscriptions/renew";

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("grace and cancel-after (every dunning attempt fails)", () => {
  it("past_due -> unpaid (grace) -> cancelled (cancel-after), voiding the open invoice as uncollectible", async () => {
    const fakeProvider = new FakeProvider();
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "grace@example.com", defaultAuthorization: "tok_visa" });

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: t0,
    });
    expect(subscription.status).toBe("active");

    const t1 = new Date("2026-02-01T00:00:00.000Z");
    // One "failed" for the renewal charge itself, then one per scheduled dunning attempt (all 4).
    fakeProvider.scriptChargeOutcomes(["failed", "failed", "failed", "failed", "failed"]);
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1);

    let [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(row.status).toBe("past_due");

    const secondInvoice = (await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id))).find(
      (invoice) => invoice.periodStart.getTime() === t1.getTime(),
    )!;
    expect(await getBalance(db, "receivable:USD")).toBe(1000n);

    // All four scheduled attempts (day 0, 3, 5, 7) are due by t1 + 7 days; one job run processes all of them.
    const graceReached = new Date(t1.getTime() + 7 * 24 * 60 * 60 * 1000);
    await runDunningJob(db, { fake: fakeProvider }, { now: graceReached });

    [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(row.status).toBe("unpaid");

    let [invoiceRow] = await db.select().from(invoices).where(eq(invoices.id, secondInvoice.id));
    expect(invoiceRow.status).toBe("open");
    expect(await getBalance(db, "receivable:USD")).toBe(1000n);

    const cancelAfterReached = new Date(t1.getTime() + 14 * 24 * 60 * 60 * 1000);
    await runDunningJob(db, { fake: fakeProvider }, { now: cancelAfterReached });

    [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(row.status).toBe("cancelled");
    expect(row.cancelledAt).not.toBeNull();

    [invoiceRow] = await db.select().from(invoices).where(eq(invoices.id, secondInvoice.id));
    expect(invoiceRow.status).toBe("uncollectible");
    expect(invoiceRow.voidedAt).not.toBeNull();

    // Voiding reverses the issued entry: receivable returns to 0, revenue drops back to just the first (paid) invoice's.
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
    expect(await getBalance(db, "revenue:USD")).toBe(-1000n);
  });
});
