import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { RecordingNotifier } from "@/core/notify";
import { db } from "@/db/client";
import { customers, dunningAttempts, invoiceLines, invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { runDunningJob } from "./dunning/run";
import { attemptInvoicePayment } from "./invoices/attempt-payment";
import { changePlan } from "./subscriptions/change-plan";
import { cancel } from "./subscriptions/lifecycle";
import { createSubscription } from "./subscriptions/create";
import { renewDueSubscriptions } from "./subscriptions/renew";

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("subscription lifecycle (fake provider, kit-mode dunning)", () => {
  it("create -> issue -> pay -> renew -> fail -> dunning recovery -> plan change -> cancel at period end -> cancelled", async () => {
    const fakeProvider = new FakeProvider();
    const notifier = new RecordingNotifier();

    const planA = await seedPlan(db, fakeProvider, { name: "Starter", amount: 1000n, currency: "USD" });
    const planB = await seedPlan(db, fakeProvider, { name: "Growth", amount: 2000n, currency: "USD" });

    // 1. Create, no trial, no saved method yet: invoice is issued but not paid.
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const customer = await seedCustomer(db, { email: "lifecycle@example.com" });
    const created = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: planA.id,
      startTrial: false,
      now: t0,
    });

    expect(created.subscription.status).toBe("active");
    expect(created.invoice?.status).toBe("open");
    expect(await getBalance(db, "receivable:USD")).toBe(1000n);
    expect(await getBalance(db, "revenue:USD")).toBe(-1000n);

    // 2. Customer adds a card; the invoice gets paid.
    await db.update(customers).set({ defaultAuthorization: "tok_visa" }).where(eq(customers.id, customer.id));
    const [customerWithCard] = await db.select().from(customers).where(eq(customers.id, customer.id));

    const firstInvoice = created.invoice!;
    const paidAttempt = await attemptInvoicePayment(db, fakeProvider, firstInvoice, customerWithCard);
    expect(paidAttempt.succeeded).toBe(true);
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(1000n);
    expect(await getBalance(db, "revenue:USD")).toBe(-1000n);

    // 3. Renew into Feb (28 days in 2026): scripted to fail this once.
    const t1 = new Date("2026-02-01T00:00:00.000Z");
    fakeProvider.scriptChargeOutcomes(["failed"]);
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1, notifier);

    let [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, created.subscription.id));
    expect(subscription.status).toBe("past_due");

    const attemptsAfterFailure = await db
      .select()
      .from(dunningAttempts)
      .innerJoin(invoices, eq(invoices.id, dunningAttempts.invoiceId))
      .where(eq(invoices.subscriptionId, subscription.id));
    expect(attemptsAfterFailure).toHaveLength(4);

    // 4. Dunning: attempt 1 (day 0) fails, attempt 2 (day 3) succeeds.
    fakeProvider.scriptChargeOutcomes(["failed", "succeeded"]);
    await runDunningJob(db, { fake: fakeProvider }, { notifier, now: t1 });

    [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, created.subscription.id));
    expect(subscription.status).toBe("past_due");

    const t1PlusThreeDays = new Date(t1.getTime() + 3 * 24 * 60 * 60 * 1000);
    await runDunningJob(db, { fake: fakeProvider }, { notifier, now: t1PlusThreeDays });

    [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, created.subscription.id));
    expect(subscription.status).toBe("active");

    const secondInvoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.subscriptionId, subscription.id))
      .then((rows) => rows.find((row) => row.periodStart.getTime() === t1.getTime())!);
    expect(secondInvoice.status).toBe("paid");

    const kinds = notifier.sent.map((n) => n.kind);
    expect(kinds).toEqual(["payment_failed", "retry_scheduled", "payment_recovered"]);

    // 5. Roll into March (31 days) with a clean renewal, then change plan on day 11.
    const t2 = new Date("2026-03-01T00:00:00.000Z");
    await renewDueSubscriptions(db, { fake: fakeProvider }, t2);
    [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, created.subscription.id));
    expect(subscription.status).toBe("active");
    expect(subscription.currentPeriodStart.toISOString()).toBe(t2.toISOString());
    expect(subscription.currentPeriodEnd.toISOString()).toBe("2026-04-01T00:00:00.000Z");

    const changeAt = new Date("2026-03-11T00:00:00.000Z");
    const changeResult = await changePlan(db, subscription.id, planB.id, changeAt);

    expect(changeResult.proration.totalDays).toBe(31);
    expect(changeResult.proration.daysUsed).toBe(10);
    expect(changeResult.proration.unusedCreditOldPlan).toBe(680n);
    expect(changeResult.proration.chargeNewPlan).toBe(1360n);
    expect(changeResult.proration.delta).toBe(680n);
    expect(changeResult.invoice).toBeDefined();
    expect(changeResult.invoice!.total).toBe(680n);
    expect(changeResult.subscription.planId).toBe(planB.id);

    const prorationLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, changeResult.invoice!.id));
    expect(prorationLines).toHaveLength(2);
    expect(prorationLines.find((line) => line.kind === "credit")?.amount).toBe(-680n);
    expect(prorationLines.find((line) => line.kind === "proration")?.amount).toBe(1360n);

    // 6. Cancel at period end, then let the period end.
    await cancel(db, fakeProvider, subscription.id, { atPeriodEnd: true });
    [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(subscription.status).toBe("active");
    expect(subscription.cancelAtPeriodEnd).toBe(true);

    const t3 = new Date("2026-04-01T00:00:00.000Z");
    await renewDueSubscriptions(db, { fake: fakeProvider }, t3);
    [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(subscription.status).toBe("cancelled");
    expect(subscription.cancelledAt).not.toBeNull();
  });
});
