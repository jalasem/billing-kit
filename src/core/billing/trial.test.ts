import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { invoices, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { createSubscription } from "./subscriptions/create";
import { renewDueSubscriptions } from "./subscriptions/renew";

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("trial subscriptions", () => {
  it("trialing -> trial ends -> invoice issued and paid -> active", async () => {
    const fakeProvider = new FakeProvider();
    const plan = await seedPlan(db, fakeProvider, { amount: 2500n, currency: "USD", trialDays: 14 });
    const customer = await seedCustomer(db, { email: "trial@example.com", defaultAuthorization: "tok_visa" });

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const { subscription, invoice } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      now: t0,
    });

    expect(subscription.status).toBe("trialing");
    expect(subscription.trialEnd?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(invoice).toBeUndefined();
    expect(await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id))).toHaveLength(0);

    const trialEnd = new Date("2026-01-15T00:00:00.000Z");
    await renewDueSubscriptions(db, { fake: fakeProvider }, trialEnd);

    const [updated] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(updated.status).toBe("active");
    expect(updated.currentPeriodStart.toISOString()).toBe(trialEnd.toISOString());

    const [firstInvoice] = await db.select().from(invoices).where(eq(invoices.subscriptionId, subscription.id));
    expect(firstInvoice.status).toBe("paid");
    expect(firstInvoice.total).toBe(2500n);
  });
});
