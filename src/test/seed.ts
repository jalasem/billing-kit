import { createPlan } from "@/core/billing/plans";
import { createProduct } from "@/core/billing/products";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { serialiseNormalisedEvent } from "@/core/webhooks/serialize";
import type { DbOrTx } from "@/db/client";
import { customers, webhookEvents } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import type { NormalisedEvent } from "@/providers/types";
import { resetM4Tables } from "./reset-db";

/** Fixed fixture emails the Playwright suite logs in as. */
export const CUSTOMER_EMAIL = "customer@example.com";
export const OPERATOR_EMAIL = "operator@example.com";

/**
 * Seeds one customer with an active `fake` subscription and a paid
 * invoice, plus the plan/product it belongs to. `OPERATOR_EMAIL` is not a
 * database row — it only needs to be listed in the `OPERATOR_EMAILS` env
 * var the app is started with (see `playwright.config.ts`) for
 * `/auth/callback` to grant it an operator session on login.
 */
export async function seed(db: DbOrTx): Promise<void> {
  await resetM4Tables(db);

  const provider = new FakeProvider();
  const product = await createProduct(db, { name: "Pro" });
  const plan = await createPlan(db, provider, {
    productId: product.id,
    name: "Pro monthly",
    interval: "month",
    amount: 2500n,
    currency: "USD",
  });

  const [customer] = await db
    .insert(customers)
    .values({ email: CUSTOMER_EMAIL, defaultAuthorization: "auth_seed" })
    .returning();

  // `defaultAuthorization` is set, so `createSubscription` charges
  // immediately through `chargeSavedMethod` (the fake provider defaults to
  // "succeeded"), landing the invoice `paid` and the subscription `active`.
  await createSubscription(db, provider, {
    customerId: customer.id,
    planId: plan.id,
    startTrial: false,
    now: new Date(),
  });

  // An unprocessed webhook event for the admin "Replay" e2e scenario: a
  // one-off `payment.succeeded` (not linked to any invoice) that
  // `handlePaymentSucceeded` can post cleanly the first time it actually
  // runs, marking the row processed.
  const seedEvent: NormalisedEvent = {
    type: "payment.succeeded",
    providerEventId: "evt_seed_replay",
    providerRef: "ch_seed_replay",
    money: { amount: 1500n, currency: "USD" },
    occurredAt: new Date(),
    raw: {},
  };
  await db.insert(webhookEvents).values({
    provider: "fake",
    eventId: seedEvent.providerEventId,
    type: seedEvent.type,
    payload: serialiseNormalisedEvent(seedEvent),
    error: "simulated failure awaiting replay",
    attempts: 1,
  });
}
