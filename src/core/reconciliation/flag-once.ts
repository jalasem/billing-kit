import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { reconciliationFlags, type ReconciliationFlag } from "@/db/schema";
import type { ProviderId } from "@/providers/types";

/**
 * Inserts a reconciliation flag unless an unresolved one already exists
 * for the same (kind, provider, ref) — enforced by a partial unique index
 * on `reconciliation_flags`, not a check-then-insert: two concurrent
 * callers racing on the same gap both attempt the insert, and Postgres's
 * `ON CONFLICT` arbiter guarantees only one of them creates a row, however
 * the two statements interleave. Returns whether *this* call created one.
 * Shared by `src/jobs/reconcile.ts` and the invoice payment-amount-mismatch
 * path in `src/core/billing/invoices/pay.ts`.
 */
export async function flagOnce(
  db: DbOrTx,
  kind: ReconciliationFlag["kind"],
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
