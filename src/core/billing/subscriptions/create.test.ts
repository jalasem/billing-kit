import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { plans } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { createSubscription } from "./create";
import { PlanNotActiveError } from "./errors";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("createSubscription", () => {
  it("throws PlanNotActiveError for a deactivated plan and creates no subscription row", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    await db.update(plans).set({ active: false }).where(eq(plans.id, plan.id));

    const customer = await seedCustomer(db, { email: "inactive-plan@example.com" });

    await expect(
      createSubscription(db, fakeProvider, { customerId: customer.id, planId: plan.id, startTrial: false }),
    ).rejects.toThrow(PlanNotActiveError);
  });

  it("succeeds for an active plan", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "active-plan@example.com" });

    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
    });
    expect(subscription.status).toBe("active");
  });
});
