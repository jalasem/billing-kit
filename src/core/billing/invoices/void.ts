import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, postEntry } from "@/core/ledger";
import { invoices, type Invoice } from "@/db/schema";

/**
 * Voids an open invoice: entry key `invoice:{id}:void` — reverses the
 * issued entry (credit `receivable:{CUR}`, debit `revenue:{CUR}`, both for
 * the invoice total). Used both for a plain void and for an uncollectible
 * write-off (`finalStatus: "uncollectible"`); the brief's rule is that an
 * uncollectible invoice is voided against revenue the same way, just
 * labelled differently. A no-op (returns the invoice unchanged) if it is
 * not `open` — already paid, or already voided/uncollectible.
 */
export async function voidInvoice(
  db: DbOrTx,
  invoice: Invoice,
  finalStatus: "void" | "uncollectible" = "void",
): Promise<Invoice> {
  if (invoice.status !== "open") {
    return invoice;
  }

  const currency = invoice.currency.toUpperCase();
  const now = new Date();

  // The reversing entry is discoverable via its own idempotency key
  // (`invoice:{id}:void`); `issuedEntryId` keeps pointing at the original
  // issued entry rather than being overwritten, so both sides of the
  // reversal stay traceable from the invoice row.
  await postEntry(db, {
    occurredAt: now,
    description: `Invoice ${invoice.number} ${finalStatus}`,
    idempotencyKey: `invoice:${invoice.id}:void`,
    postings: [
      { accountCode: chartOfAccounts.receivable(currency), amount: -invoice.total, currency },
      { accountCode: chartOfAccounts.revenue(currency), amount: invoice.total, currency },
    ],
  });

  const [voided] = await db
    .update(invoices)
    .set({ status: finalStatus, voidedAt: now })
    .where(eq(invoices.id, invoice.id))
    .returning();

  return voided;
}
