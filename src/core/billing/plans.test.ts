import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { FakeProvider } from "@/providers/fake";
import { createProduct } from "@/core/billing/products";
import { resetM3Tables } from "@/test/reset-db";
import { createPlan } from "./plans";

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("createPlan", () => {
  it("creates a provider-side plan when provider_refs is not supplied", async () => {
    const provider = new FakeProvider();
    const product = await createProduct(db, { name: "Product" });

    const plan = await createPlan(db, provider, {
      productId: product.id,
      name: "Starter",
      interval: "month",
      amount: 1000n,
      currency: "USD",
    });

    expect(plan.providerRefs.fake).toBe("plan_fake_1");
  });

  it("skips calling the provider when provider_refs already supplies a ref for this provider", async () => {
    const provider = new FakeProvider();
    const product = await createProduct(db, { name: "Product" });

    const plan = await createPlan(db, provider, {
      productId: product.id,
      name: "Starter",
      interval: "month",
      amount: 1000n,
      currency: "USD",
      providerRefs: { fake: "plan_hand_created_1" },
    });

    expect(plan.providerRefs.fake).toBe("plan_hand_created_1");

    // If the supplied ref had been ignored, this second call would have
    // consumed the provider's first auto-generated id ("plan_fake_1")
    // instead of its second ("plan_fake_2") — proving the first call above
    // never actually called `provider.createPlan`.
    const second = await createPlan(db, provider, {
      productId: product.id,
      name: "Growth",
      interval: "month",
      amount: 2000n,
      currency: "USD",
    });
    expect(second.providerRefs.fake).toBe("plan_fake_1");
  });

  it("preserves other providers' refs already present alongside the newly created one", async () => {
    const provider = new FakeProvider();
    const product = await createProduct(db, { name: "Product" });

    const plan = await createPlan(db, provider, {
      productId: product.id,
      name: "Starter",
      interval: "month",
      amount: 1000n,
      currency: "USD",
      providerRefs: { stripe: "price_existing_1" },
    });

    expect(plan.providerRefs.stripe).toBe("price_existing_1");
    expect(plan.providerRefs.fake).toBe("plan_fake_1");
  });
});
