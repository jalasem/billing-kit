import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { flagOnce } from "@/core/reconciliation/flag-once";
import { chartOfAccounts, ensureChartOfAccounts, postEntry, type PostingInput } from "@/core/ledger";
import { invoices, type Invoice } from "@/db/schema";
import type { Money, ProviderId } from "@/providers/types";
import { InvalidInvoiceStateError } from "./errors";

export interface MarkInvoicePaidInput {
  provider: ProviderId;
  /** The provider's reference for the payment that paid this invoice (charge id, payment intent id, transaction reference). */
  providerRef: string;
  /** What the provider actually reports collecting — compared against `invoice.total`/`invoice.currency`; see the mismatch handling below. */
  amount: bigint;
  currency: string;
  fee?: Money;
  occurredAt: Date;
}

export interface MarkInvoicePaidResult {
  invoice: Invoice;
  /**
   * `"paid"`: the amount/currency matched (or this is a replay of an
   * already-paid invoice) and the invoice is now paid. `"unapplied"`: they
   * did not match — the invoice is left `open`, a `reconciliation_flags`
   * row (`invoice_amount_mismatch`) was raised, and the cash received was
   * still posted, against `unapplied:{provider}:{CUR}` rather than lost.
   */
  outcome: "paid" | "unapplied";
  /**
   * The ledger entry this call posted — the "paid" entry, or the
   * "unapplied receipt" entry, whichever `outcome` says. `undefined` only
   * when `invoice` was already `paid` before this call (nothing posted).
   * Distinct from `invoice.paidEntryId`, which stays whatever it already
   * was (`null` for an `"unapplied"` outcome, since the invoice itself was
   * never marked paid).
   */
  entryId?: string;
}

/**
 * Pays an invoice: entry key `invoice:{id}:paid` — debit
 * `cash:{provider}:{CUR}` for the invoice total, credit `receivable:{CUR}`.
 * A reported fee is posted the same way M2 posts a payment fee (debit
 * `fees`, credit `cash`). Idempotent both via `postEntry`'s idempotency key
 * and by short-circuiting on an already-paid invoice, so this is safe to
 * call from a redelivered webhook or a retried dunning attempt.
 *
 * Enforces invoice state at the source of truth rather than trusting a
 * caller's already-open invoice row to still be open: an invoice that is
 * `paid` is a no-op replay; one that is anything else `open`-adjacent
 * (`draft`, `void`, `uncollectible`) cannot be paid and throws
 * `InvalidInvoiceStateError` — a caller that raced a void, or that simply
 * has a stale row, must not silently post a paid entry against it.
 *
 * Does **not** assume `input.amount`/`input.currency` equal the invoice's
 * own total/currency — see `handlePaymentSucceeded`, which is the only
 * caller where they can legitimately differ (a provider's reported amount
 * for an invoice-linked payment). A mismatch does not fail: it takes the
 * `"unapplied"` branch documented on `MarkInvoicePaidResult`.
 */
export async function markInvoicePaid(db: DbOrTx, invoice: Invoice, input: MarkInvoicePaidInput): Promise<MarkInvoicePaidResult> {
  if (invoice.status === "paid") {
    return { invoice, outcome: "paid", entryId: invoice.paidEntryId ?? undefined };
  }
  if (invoice.status !== "open") {
    throw new InvalidInvoiceStateError(invoice.id, invoice.status, "pay");
  }

  const invoiceCurrency = invoice.currency.toUpperCase();
  const eventCurrency = input.currency.toUpperCase();

  if (input.amount !== invoice.total || eventCurrency !== invoiceCurrency) {
    const entryId = await postUnappliedReceipt(db, invoice, input, eventCurrency);
    return { invoice, outcome: "unapplied", entryId };
  }

  await ensureChartOfAccounts(db, invoiceCurrency);

  const postings: PostingInput[] = [
    { accountCode: chartOfAccounts.cash(input.provider, invoiceCurrency), amount: invoice.total, currency: invoiceCurrency },
    { accountCode: chartOfAccounts.receivable(invoiceCurrency), amount: -invoice.total, currency: invoiceCurrency },
  ];

  if (input.fee && input.fee.amount > 0n) {
    postings.push(
      { accountCode: chartOfAccounts.fees(input.provider, invoiceCurrency), amount: input.fee.amount, currency: invoiceCurrency },
      { accountCode: chartOfAccounts.cash(input.provider, invoiceCurrency), amount: -input.fee.amount, currency: invoiceCurrency },
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

  return { invoice: paid, outcome: "paid", entryId: entry.id };
}

/**
 * The invoice stays `open`; the money is not lost. Debits
 * `cash:{provider}:{CUR}` and credits `unapplied:{provider}:{CUR}` for
 * whatever the provider actually reported, keyed on the provider's own
 * reference so a redelivery of the same mismatched event is a no-op, and
 * raises (once) a `reconciliation_flags` row an operator can resolve by
 * applying the receipt manually. Returns the posted entry's id.
 */
async function postUnappliedReceipt(
  db: DbOrTx,
  invoice: Invoice,
  input: MarkInvoicePaidInput,
  eventCurrency: string,
): Promise<string> {
  await ensureChartOfAccounts(db, eventCurrency);

  const { entry } = await postEntry(db, {
    occurredAt: input.occurredAt,
    description: `Unapplied receipt for invoice ${invoice.number} (amount/currency mismatch)`,
    idempotencyKey: `invoice:${invoice.id}:unapplied:${input.provider}:${input.providerRef}`,
    postings: [
      { accountCode: chartOfAccounts.cash(input.provider, eventCurrency), amount: input.amount, currency: eventCurrency },
      { accountCode: chartOfAccounts.unapplied(input.provider, eventCurrency), amount: -input.amount, currency: eventCurrency },
    ],
  });

  await flagOnce(db, "invoice_amount_mismatch", input.provider, invoice.id, {
    invoiceNumber: invoice.number,
    providerRef: input.providerRef,
    expectedAmount: invoice.total.toString(),
    expectedCurrency: invoice.currency,
    actualAmount: input.amount.toString(),
    actualCurrency: eventCurrency,
  });

  return entry.id;
}
