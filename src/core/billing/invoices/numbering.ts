import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { invoiceSequences } from "@/db/schema";

/**
 * Allocates the next `INV-{year}-{000001}` number for `year`, inside the
 * caller's transaction. The `UPDATE ... RETURNING` takes a row lock on the
 * sequence row, so two concurrent invoices for the same year serialize on
 * that lock instead of racing to the same number; the initial insert is
 * `ON CONFLICT DO NOTHING` so a first-ever call for a year doesn't race
 * against another first-ever call.
 */
export async function allocateInvoiceNumber(tx: DbOrTx, year: number): Promise<string> {
  await tx.insert(invoiceSequences).values({ year, next: 1 }).onConflictDoNothing({ target: invoiceSequences.year });

  const [row] = await tx
    .update(invoiceSequences)
    .set({ next: sql`${invoiceSequences.next} + 1` })
    .where(eq(invoiceSequences.year, year))
    .returning({ next: invoiceSequences.next });

  const allocated = row.next - 1;
  return `INV-${year}-${String(allocated).padStart(6, "0")}`;
}
