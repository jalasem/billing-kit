import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { auditLog, subscriptions, type Subscription } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";
import { transition } from "./state";

export interface CancelOptions {
  /** Cancel at the end of the current period instead of immediately. Defaults to `false`. */
  atPeriodEnd?: boolean;
}

/** Every status-changing (or flag-changing) mutation here writes one of these, so the admin subscription screen can show a real history. */
async function recordAudit(tx: DbOrTx, actor: string, action: string, subscriptionId: string, details: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ actor, action, subject: subscriptionId, details });
}

/**
 * Cancels a subscription. Immediate cancellation transitions straight to
 * `cancelled` and cancels the provider-side subscription now;
 * `atPeriodEnd` only sets the flag (validated by the `cancel_at_period_end`
 * event, which is a no-op transition) — `renewDueSubscriptions` is what
 * actually cancels it once the period ends. `actor` (defaults `"system"`)
 * is the email recorded on the resulting `audit_log` row — the portal
 * passes the customer's email, the admin actions pass the operator's.
 */
export async function cancel(
  db: DbOrTx,
  provider: PaymentProvider,
  subscriptionId: string,
  options: CancelOptions = {},
  actor = "system",
): Promise<Subscription> {
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
      await recordAudit(tx, actor, "subscription.cancel_at_period_end", subscriptionId, { periodEnd: subscription.currentPeriodEnd });
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

    await recordAudit(tx, actor, "subscription.cancel", subscriptionId, { from: subscription.status, to: nextStatus });
    return updated;
  });
}

export async function pause(db: DbOrTx, subscriptionId: string, actor = "system"): Promise<Subscription> {
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
    await recordAudit(tx, actor, "subscription.pause", subscriptionId, { from: subscription.status, to: nextStatus });
    return updated;
  });
}

/**
 * Undoes a pending `cancel_at_period_end`. Flag-only, like the event it
 * reverses: the subscription's status does not change, so there is no
 * state-machine transition to validate — this is a no-op (returns the
 * subscription unchanged, and writes no audit row) when the flag was not
 * set.
 */
export async function resumeCancelAtPeriodEnd(db: DbOrTx, subscriptionId: string, actor = "system"): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
    if (!subscription) {
      throw new Error(`Unknown subscription: ${subscriptionId}`);
    }
    if (!subscription.cancelAtPeriodEnd) {
      return subscription;
    }
    const [updated] = await tx
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    await recordAudit(tx, actor, "subscription.resume_cancel_at_period_end", subscriptionId, {});
    return updated;
  });
}

export async function resume(db: DbOrTx, subscriptionId: string, actor = "system"): Promise<Subscription> {
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
    await recordAudit(tx, actor, "subscription.resume", subscriptionId, { from: subscription.status, to: nextStatus });
    return updated;
  });
}
