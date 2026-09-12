import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { dunningAttempts, invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { runDunningJob } from "./dunning/run";
import { createSubscription } from "./subscriptions/create";
import { renewDueSubscriptions } from "./subscriptions/renew";

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("M3 idempotency", () => {
  it("running renewDueSubscriptions twice for the same due period issues exactly one invoice", async () => {
    const fakeProvider = new FakeProvider();
    const plan = await seedPlan(db, fakeProvider, { amount: 900n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "idempotent-renew@example.com" });

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: t0,
    });

    const t1 = new Date("2026-02-01T00:00:00.000Z");
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1);
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1);

    const rows = await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id));
    const forPeriod = rows.filter((row) => row.periodStart.getTime() === t1.getTime());
    expect(forPeriod).toHaveLength(1);

    const [advanced] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(advanced.currentPeriodStart.toISOString()).toBe(t1.toISOString());
  });

  it("running the dunning job twice executes each due attempt exactly once", async () => {
    const fakeProvider = new FakeProvider();
    const plan = await seedPlan(db, fakeProvider, { amount: 700n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "idempotent-dunning@example.com", defaultAuthorization: "tok_visa" });

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: t0,
    });

    const t1 = new Date("2026-02-01T00:00:00.000Z");
    fakeProvider.scriptChargeOutcomes(["failed"]);
    await renewDueSubscriptions(db, { fake: fakeProvider }, t1);

    fakeProvider.scriptChargeOutcomes(["succeeded"]);
    const first = await runDunningJob(db, { fake: fakeProvider }, { now: t1 });
    expect(first.attempted).toBe(1);
    expect(first.recovered).toBe(1);

    const second = await runDunningJob(db, { fake: fakeProvider }, { now: t1 });
    expect(second.attempted).toBe(0);

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(row.status).toBe("active");

    const attempts = await db
      .select({ attempt: dunningAttempts })
      .from(dunningAttempts)
      .innerJoin(invoices, eq(invoices.id, dunningAttempts.invoiceId))
      .where(eq(invoices.subscriptionId, subscription.id));
    const executed = attempts.filter((row) => row.attempt.executedAt !== null);
    expect(executed).toHaveLength(4); // 1 succeeded, 3 skipped once recovery happened — none left pending or re-run.
  });
});
