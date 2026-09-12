import { and, eq, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { postSettlement } from "@/core/webhooks/settlement";
import { payments, reconciliationFlags } from "@/db/schema";
import type { PaymentProvider, ProviderId } from "@/providers/types";

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReconcileOptions {
  /** Defaults to 7 days before `to`. */
  from?: Date;
  /** Defaults to now. */
  to?: Date;
}

export interface ReconcileSummary {
  settlementsSeen: number;
  settlementsPosted: number;
  unsettledPaymentFlags: number;
  unknownSettlementRefFlags: number;
}

/**
 * Reconciles one provider's settlements into the ledger and flags gaps.
 * Idempotent: a settlement already posted (by an earlier run or by the
 * `settlement.posted` webhook) is skipped, and a flag is only created once
 * per (kind, provider, ref) while unresolved — so running this twice over
 * the same or an overlapping window creates no new entries or flags.
 */
export async function reconcileProvider(
  db: DbOrTx,
  providerId: ProviderId,
  provider: PaymentProvider,
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const to = options.to ?? new Date();
  const from = options.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS);

  const summary: ReconcileSummary = {
    settlementsSeen: 0,
    settlementsPosted: 0,
    unsettledPaymentFlags: 0,
    unknownSettlementRefFlags: 0,
  };

  const settlementsFromProvider = await provider.listSettlements({ from, to });
  const settledRefs = new Set<string>();

  for (const settlement of settlementsFromProvider) {
    summary.settlementsSeen += 1;
    settlement.paymentRefs.forEach((ref) => settledRefs.add(ref));

    const result = await postSettlement(db, {
      provider: providerId,
      settlementId: settlement.settlementId,
      gross: settlement.money,
      fee: settlement.fee,
      settledAt: settlement.settledAt,
    });
    if (result.created) {
      summary.settlementsPosted += 1;
    }

    for (const ref of settlement.paymentRefs) {
      const [payment] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.provider, providerId), eq(payments.providerRef, ref)));

      if (!payment) {
        const flagged = await flagOnce(db, "unknown_settlement_ref", providerId, ref, {
          settlementId: settlement.settlementId,
        });
        if (flagged) {
          summary.unknownSettlementRefFlags += 1;
        }
      }
    }
  }

  const staleCutoff = new Date(to.getTime() - STALE_AFTER_MS);
  const staleSucceeded = await db
    .select({ id: payments.id, providerRef: payments.providerRef })
    .from(payments)
    .where(and(eq(payments.provider, providerId), eq(payments.status, "succeeded"), lt(payments.occurredAt, staleCutoff)));

  for (const payment of staleSucceeded) {
    if (settledRefs.has(payment.providerRef)) {
      continue;
    }
    const flagged = await flagOnce(db, "unsettled_payment", providerId, payment.providerRef, {
      paymentId: payment.id,
    });
    if (flagged) {
      summary.unsettledPaymentFlags += 1;
    }
  }

  return summary;
}

/** Runs reconciliation for every given provider and returns one summary per provider id. */
export async function reconcile(
  db: DbOrTx,
  providers: Partial<Record<ProviderId, PaymentProvider>>,
  options: ReconcileOptions = {},
): Promise<Record<string, ReconcileSummary>> {
  const summaries: Record<string, ReconcileSummary> = {};
  for (const [providerId, provider] of Object.entries(providers) as Array<[ProviderId, PaymentProvider | undefined]>) {
    if (!provider) {
      continue;
    }
    summaries[providerId] = await reconcileProvider(db, providerId, provider, options);
  }
  return summaries;
}

/**
 * Inserts a flag unless an unresolved one already exists for the same
 * (kind, provider, ref) — enforced by a partial unique index (see the
 * `reconciliation_flags` schema), not a check-then-insert: two concurrent
 * reconcile runs racing on the same gap both attempt the insert, and
 * Postgres's `ON CONFLICT` arbiter guarantees only one of them creates a
 * row, however the two statements interleave. Returns whether *this* call
 * created one.
 */
async function flagOnce(
  db: DbOrTx,
  kind: "unsettled_payment" | "unknown_settlement_ref",
  provider: ProviderId,
  ref: string,
  details: Record<string, unknown>,
): Promise<boolean> {
  const [inserted] = await db
    .insert(reconciliationFlags)
    .values({ kind, provider, ref, details })
    .onConflictDoNothing({
      target: [reconciliationFlags.kind, reconciliationFlags.provider, reconciliationFlags.ref],
      where: sql`${reconciliationFlags.resolvedAt} is null`,
    })
    .returning();

  return Boolean(inserted);
}
