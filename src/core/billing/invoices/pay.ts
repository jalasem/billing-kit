import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, ensureChartOfAccounts, postEntry, type PostingInput } from "@/core/ledger";
import { invoices, type Invoice } from "@/db/schema";
import type { Money, ProviderId } from "@/providers/types";

export interface MarkInvoicePaidInput {
  provider: ProviderId;
  /** The provider's reference for the payment that paid this invoice (charge id, payment intent id, transaction reference). */
  providerRef: string;
  fee?: Money;
  occurredAt: Date;
}

/**
 * Pays an invoice: entry key `invoice:{id}:paid` — debit
 * `cash:{provider}:{CUR}` for the invoice total, credit `receivable:{CUR}`.
 * A reported fee is posted the same way M2 posts a payment fee (debit
 * `fees`, credit `cash`). Idempotent both via `postEntry`'s idempotency key
 * and by short-circuiting on an already-paid invoice, so this is safe to
 * call from a redelivered webhook or a retried dunning attempt.
 */
export async function markInvoicePaid(db: DbOrTx, invoice: Invoice, input: MarkInvoicePaidInput): Promise<Invoice> {
  if (invoice.status === "paid") {
    return invoice;
  }

  const currency = invoice.currency.toUpperCase();
  await ensureChartOfAccounts(db, currency);

  const postings: PostingInput[] = [
    { accountCode: chartOfAccounts.cash(input.provider, currency), amount: invoice.total, currency },
    { accountCode: chartOfAccounts.receivable(currency), amount: -invoice.total, currency },
  ];

  if (input.fee && input.fee.amount > 0n) {
    postings.push(
      { accountCode: chartOfAccounts.fees(input.provider, currency), amount: input.fee.amount, currency },
      { accountCode: chartOfAccounts.cash(input.provider, currency), amount: -input.fee.amount, currency },
    );
  }

  const { entry } = await postEntry(db, {
    occurredAt: input.occurredAt,
    description: `Invoice ${invoice.number} paid`,
    idempotencyKey: `invoice:${invoice.id}:paid`,
    postings,
  });

  const [paid] = await db
    .update(invoices)
    .set({
      status: "paid",
      amountPaid: invoice.total,
      paidAt: input.occurredAt,
      paidEntryId: entry.id,
      providerRef: invoice.providerRef ?? input.providerRef,
    })
    .where(eq(invoices.id, invoice.id))
    .returning();

  return paid;
}
