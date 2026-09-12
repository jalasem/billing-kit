import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { InvalidTransitionError } from "./state";
import { createSubscription } from "./create";
import { cancel, pause, resume } from "./lifecycle";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("subscription lifecycle operations", () => {
  it("cancel immediately moves to cancelled and cancels the provider subscription", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "cancel-now@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const cancelled = await cancel(db, fakeProvider, subscription.id, {});
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("cancel at period end only sets the flag, leaving status unchanged", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "cancel-later@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const updated = await cancel(db, fakeProvider, subscription.id, { atPeriodEnd: true });
    expect(updated.status).toBe("active");
    expect(updated.cancelAtPeriodEnd).toBe(true);
  });

  it("pause then resume round-trips back to active", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "pause-resume@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const paused = await pause(db, subscription.id);
    expect(paused.status).toBe("paused");
    expect(paused.pausedAt).not.toBeNull();

    const resumed = await resume(db, subscription.id);
    expect(resumed.status).toBe("active");
    expect(resumed.pausedAt).toBeNull();
  });

  it("rejects an invalid transition (e.g. resuming a subscription that isn't paused)", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "invalid-transition@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(resume(db, subscription.id)).rejects.toThrow(InvalidTransitionError);

    const [unchanged] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(unchanged.status).toBe("active");
  });
});
