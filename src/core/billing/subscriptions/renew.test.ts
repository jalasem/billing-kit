import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { createSubscription } from "./create";
import { pause } from "./lifecycle";
import { renewDueSubscriptions } from "./renew";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("renewDueSubscriptions excludes paused subscriptions", () => {
  it("does not renew a paused subscription even though its period has ended", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 600n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "paused-renew@example.com" });

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: t0,
    });

    const paused = await pause(db, subscription.id);
    expect(paused.status).toBe("paused");

    const t1 = new Date("2026-02-01T00:00:00.000Z"); // the period has now ended
    const summary = await renewDueSubscriptions(db, { fake: fakeProvider }, t1);

    expect(summary.renewed).toBe(0);
    expect(summary.trialsActivated).toBe(0);

    const [unchanged] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(unchanged.status).toBe("paused");
    expect(unchanged.currentPeriodStart.toISOString()).toBe(t0.toISOString());
    expect(unchanged.currentPeriodEnd.toISOString()).toBe(t1.toISOString());

    const invoicesForPeriod = (await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id))).filter(
      (row) => row.periodStart.getTime() === t1.getTime(),
    );
    expect(invoicesForPeriod).toHaveLength(0);
  });
});
