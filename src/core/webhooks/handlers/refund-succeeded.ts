import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, ensureChartOfAccounts, postEntry } from "@/core/ledger";
import { payments, refunds } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";
import { findPayment } from "./payment-succeeded";

type RefundSucceededEvent = Extract<NormalisedEvent, { type: "refund.succeeded" }>;

/**
 * Debits `refunds:{CUR}` and credits the provider's clearing account, keyed
 * on `refund:{provider}:{ref}` so a replayed webhook posts nothing twice.
 * The payment is marked `refunded` once the sum of its refunds reaches its
 * original amount.
 */
export async function handleRefundSucceeded(
  db: DbOrTx,
  provider: ProviderId,
  event: RefundSucceededEvent,
): Promise<void> {
  const payment = await findPayment(db, provider, event.paymentRef);
  if (!payment) {
    throw new Error(`refund.succeeded for unknown payment ${provider}:${event.paymentRef}`);
  }

  const currency = event.money.currency.toUpperCase();
  await ensureChartOfAccounts(db, currency);

  const { entry } = await postEntry(db, {
    occurredAt: event.occurredAt,
    description: `${provider} refund ${event.providerRef}`,
    idempotencyKey: `refund:${provider}:${event.providerRef}`,
    postings: [
      { accountCode: chartOfAccounts.refunds(currency), amount: event.money.amount, currency },
      { accountCode: chartOfAccounts.cash(provider, currency), amount: -event.money.amount, currency },
    ],
  });

  const [inserted] = await db
    .insert(refunds)
    .values({
      paymentId: payment.id,
      provider,
      providerRef: event.providerRef,
      amount: event.money.amount,
      currency,
      entryId: entry.id,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({ target: [refunds.provider, refunds.providerRef] })
    .returning();

  if (!inserted) {
    // Already recorded by an earlier delivery of this event; nothing left to do.
    return;
  }

  const [{ refunded }] = await db
    .select({ refunded: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
    .from(refunds)
    .where(eq(refunds.paymentId, payment.id));

  if (BigInt(refunded) >= payment.amount) {
    await db.update(payments).set({ status: "refunded" }).where(eq(payments.id, payment.id));
  }
}
