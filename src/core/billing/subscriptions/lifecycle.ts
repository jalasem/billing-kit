import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { subscriptions, type Subscription } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";
import { transition } from "./state";

export interface CancelOptions {
  /** Cancel at the end of the current period instead of immediately. Defaults to `false`. */
  atPeriodEnd?: boolean;
}

/**
 * Cancels a subscription. Immediate cancellation transitions straight to
 * `cancelled` and cancels the provider-side subscription now;
 * `atPeriodEnd` only sets the flag (validated by the `cancel_at_period_end`
 * event, which is a no-op transition) — `renewDueSubscriptions` is what
 * actually cancels it once the period ends.
 */
export async function cancel(db: DbOrTx, provider: PaymentProvider, subscriptionId: string, options: CancelOptions = {}): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
    if (!subscription) {
      throw new Error(`Unknown subscription: ${subscriptionId}`);
    }

    if (options.atPeriodEnd) {
      transition(subscription.status, "cancel_at_period_end");
      const [updated] = await tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(subscriptions.id, subscriptionId))
        .returning();
      return updated;
    }

    const nextStatus = transition(subscription.status, "cancel");
    const now = new Date();
    const [updated] = await tx
      .update(subscriptions)
      .set({ status: nextStatus, cancelledAt: now, cancelAtPeriodEnd: false, updatedAt: now })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();

    if (subscription.providerSubscriptionId) {
      await provider.cancelSubscription(subscription.providerSubscriptionId);
    }

    return updated;
  });
}

export async function pause(db: DbOrTx, subscriptionId: string): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
    if (!subscription) {
      throw new Error(`Unknown subscription: ${subscriptionId}`);
    }

    const nextStatus = transition(subscription.status, "pause");
    const now = new Date();
    const [updated] = await tx
      .update(subscriptions)
      .set({ status: nextStatus, pausedAt: now, updatedAt: now })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    return updated;
  });
}

export async function resume(db: DbOrTx, subscriptionId: string): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
    if (!subscription) {
      throw new Error(`Unknown subscription: ${subscriptionId}`);
    }

    const nextStatus = transition(subscription.status, "resume");
    const now = new Date();
    const [updated] = await tx
      .update(subscriptions)
      .set({ status: nextStatus, pausedAt: null, updatedAt: now })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    return updated;
  });
}
