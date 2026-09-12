import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, ensureChartOfAccounts, postEntry } from "@/core/ledger";
import { settlements } from "@/db/schema";
import type { Money, ProviderId } from "@/providers/types";

/**
 * Whether a provider's per-transaction fee is already posted (debited out
 * of the clearing account) at `payment.succeeded` time, so a settlement
 * must not post it again. Paystack takes its fee off each charge as it
 * happens; Stripe's payout in the fixtures carries no extra fee of its own
 * (see `src/providers/stripe/mapping.ts`), so there is nothing to skip
 * there either, but the flag documents the intended rule if that changes.
 */
export const FEE_ALREADY_POSTED_PER_PAYMENT: Record<ProviderId, boolean> = {
  stripe: false,
  paystack: true,
  fake: false,
};

export interface PostSettlementInput {
  provider: ProviderId;
  settlementId: string;
  /** The gross amount that should leave the provider's clearing account. */
  gross: Money;
  /** The settlement-time fee; ignored when the provider already posted it per-payment. */
  fee: Money;
  settledAt: Date;
}

export interface PostSettlementResult {
  /** False when this settlement was already posted by an earlier call (webhook or reconcile job). */
  created: boolean;
}

/**
 * Posts one settlement's ledger entry, idempotently: a settlement is looked
 * up by (provider, settlementId) before doing anything else, so a replayed
 * webhook or a second reconcile run over the same window is a no-op.
 *
 * - debit `bank:{CUR}` for the net that hit the bank
 * - debit `fees:{provider}:{CUR}` for a settlement-time fee, only if it was
 *   not already posted per payment
 * - credit `cash:{provider}:{CUR}` for the gross removed from clearing
 */
export async function postSettlement(db: DbOrTx, input: PostSettlementInput): Promise<PostSettlementResult> {
  const currency = input.gross.currency.toUpperCase();

  const [existing] = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.provider, input.provider), eq(settlements.settlementId, input.settlementId)));

  if (existing) {
    return { created: false };
  }

  await ensureChartOfAccounts(db, currency);

  const feeAlreadyPosted = FEE_ALREADY_POSTED_PER_PAYMENT[input.provider] || input.fee.amount === 0n;
  const postings = feeAlreadyPosted
    ? [
        { accountCode: chartOfAccounts.bank(currency), amount: input.gross.amount, currency },
        { accountCode: chartOfAccounts.cash(input.provider, currency), amount: -input.gross.amount, currency },
      ]
    : [
        {
          accountCode: chartOfAccounts.bank(currency),
          amount: input.gross.amount - input.fee.amount,
          currency,
        },
        { accountCode: chartOfAccounts.fees(input.provider, currency), amount: input.fee.amount, currency },
        { accountCode: chartOfAccounts.cash(input.provider, currency), amount: -input.gross.amount, currency },
      ];

  const { entry } = await postEntry(db, {
    occurredAt: input.settledAt,
    description: `${input.provider} settlement ${input.settlementId}`,
    idempotencyKey: `settlement:${input.provider}:${input.settlementId}`,
    postings,
  });

  // The `existing` check above is a fast path, not the source of truth: two
  // concurrent calls for the same settlement can both pass it (classic
  // check-then-act race). `postEntry` is idempotent either way (both land
  // on the same ledger entry), but only one of these inserts actually wins
  // — `.returning()` tells us which, so `created` reflects reality instead
  // of assuming this call was first because it got this far.
  const [inserted] = await db
    .insert(settlements)
    .values({
      provider: input.provider,
      settlementId: input.settlementId,
      amount: input.gross.amount,
      fee: input.fee.amount,
      currency,
      settledAt: input.settledAt,
      entryId: entry.id,
    })
    .onConflictDoNothing({ target: [settlements.provider, settlements.settlementId] })
    .returning();

  return { created: Boolean(inserted) };
}
