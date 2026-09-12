import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
    has: (name: string) => store.has(name),
    clear: () => store.clear(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieJar,
}));

import { eq } from "drizzle-orm";
import { createSessionRow } from "@/core/auth/session";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { db } from "@/db/client";
import { plans, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM4Tables } from "@/test/reset-db";
import { cancelAtPeriodEndAction, subscribeAction } from "./actions";

const fakeProvider = new FakeProvider();

async function loginAs(email: string, customerId: string | null): Promise<void> {
  const session = await createSessionRow(db, { email, customerId, isOperator: false });
  cookieJar.set("bk_session", session.id);
}

function formData(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

/** `redirect()` throws to unwind the request; we only care whether the mutation happened, not the thrown control-flow value. */
async function runAction(action: (formData: FormData) => Promise<void>, form: FormData): Promise<void> {
  try {
    await action(form);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("NEXT_REDIRECT")) {
      throw error;
    }
  }
}

beforeEach(async () => {
  await resetM4Tables(db);
  cookieJar.clear();
});

describe("portal server action authorization", () => {
  it("a customer cannot cancel another customer's subscription", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const owner = await seedCustomer(db, { email: "owner@example.com" });
    const intruder = await seedCustomer(db, { email: "intruder@example.com" });

    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: owner.id,
      planId: plan.id,
      startTrial: false,
    });

    await loginAs("intruder@example.com", intruder.id);
    await runAction(cancelAtPeriodEndAction, formData({ subscriptionId: subscription.id }));

    const [unchanged] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(unchanged.cancelAtPeriodEnd).toBe(false);
    expect(unchanged.status).toBe("active");
  });

  it("rejects the mutation with no session at all", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const owner = await seedCustomer(db, { email: "owner2@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: owner.id,
      planId: plan.id,
      startTrial: false,
    });

    await expect(cancelAtPeriodEndAction(formData({ subscriptionId: subscription.id }))).rejects.toThrow();

    const [unchanged] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(unchanged.cancelAtPeriodEnd).toBe(false);
  });

  it("allows the owning customer to cancel their own subscription", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const owner = await seedCustomer(db, { email: "owner3@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: owner.id,
      planId: plan.id,
      startTrial: false,
    });

    await loginAs("owner3@example.com", owner.id);
    await runAction(cancelAtPeriodEndAction, formData({ subscriptionId: subscription.id }));

    const [updated] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(updated.cancelAtPeriodEnd).toBe(true);
  });

  it("subscribeAction rejects a deactivated plan and creates no subscription", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    await db.update(plans).set({ active: false }).where(eq(plans.id, plan.id));
    const customer = await seedCustomer(db, { email: "wants-inactive-plan@example.com" });

    await loginAs("wants-inactive-plan@example.com", customer.id);
    await runAction(subscribeAction, formData({ planId: plan.id }));

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.customerId, customer.id));
    expect(rows).toHaveLength(0);
  });
});
