import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { customers } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { changePlan } from "./change-plan";
import { createSubscription } from "./create";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("changePlan applies pending customer credit to its proration invoice", () => {
  it("reduces the proration invoice's total by whatever credit the customer already had", async () => {
    const oldPlan = await seedPlan(db, fakeProvider, { name: "Old", amount: 1000n, currency: "USD" });
    const newPlan = await seedPlan(db, fakeProvider, { name: "New", amount: 2000n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "change-plan-credit@example.com" });

    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: oldPlan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    // Set *after* the subscription's own first invoice was issued (which
    // also applies customer credit), so this credit is still there for
    // the proration invoice below to consume.
    await db.update(customers).set({ customerCredits: 300n }).where(eq(customers.id, customer.id));

    const result = await changePlan(db, subscription.id, newPlan.id, new Date("2026-01-11T00:00:00.000Z"));

    // Same worked example as proration.test.ts: delta is 680 before credit.
    expect(result.proration.delta).toBe(680n);
    expect(result.invoice).toBeDefined();
    expect(result.invoice!.subtotal).toBe(680n);
    expect(result.invoice!.total).toBe(380n); // 680 - 300 credit

    const [updatedCustomer] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(updatedCustomer.customerCredits).toBe(0n);
  });
});
