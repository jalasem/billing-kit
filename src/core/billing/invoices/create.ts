import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, ensureChartOfAccounts, postEntry } from "@/core/ledger";
import { customers, invoiceLines, invoices, type Invoice, type InvoiceLine } from "@/db/schema";
import type { ProviderId } from "@/providers/types";
import { allocateInvoiceNumber } from "./numbering";

export interface InvoiceLineInput {
  kind: InvoiceLine["kind"];
  description: string;
  quantity?: number;
  unitAmount: bigint;
  amount: bigint;
  planId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface CreateInvoiceInput {
  customerId: string;
  subscriptionId: string | null;
  provider: ProviderId;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  lines: InvoiceLineInput[];
  /** Applies (and consumes) the customer's `customer_credits` against this invoice's subtotal. */
  applyCustomerCredit?: boolean;
}

export interface CreateInvoiceResult {
  invoice: Invoice;
  lines: InvoiceLine[];
  /** False when an invoice already existed for this (subscription, period_start) and nothing new was created. */
  created: boolean;
}

/**
 * Issues one invoice: idempotent per (subscription_id, period_start) via
 * the unique index on `invoices`, allocates its number, writes its lines,
 * and posts the "issued" ledger entry (`invoice:{id}:issued`) — debit
 * `receivable:{CUR}` for the total, credit `revenue:{CUR}`. Credit and
 * proration lines are negative, so they reduce the total without breaking
 * the entry's balance (see `src/core/ledger/README.md`).
 *
 * A total of exactly zero (fully covered by applied customer credit) skips
 * the ledger entry — there is no cash or revenue movement to record — and
 * the invoice is created already `paid`.
 */
export async function createInvoice(db: DbOrTx, input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  return db.transaction(async (tx) => {
    if (input.subscriptionId) {
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.subscriptionId, input.subscriptionId), eq(invoices.periodStart, input.periodStart)));
      if (existing) {
        const existingLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, existing.id));
        return { invoice: existing, lines: existingLines, created: false };
      }
    }

    const currency = input.currency.toUpperCase();
    await ensureChartOfAccounts(tx, currency);

    const subtotal = input.lines.reduce((sum, line) => sum + line.amount, 0n);

    let creditApplied = 0n;
    if (input.applyCustomerCredit) {
      // Locks the customer row for the rest of this transaction: a second
      // concurrent invoice for the same customer that also wants to apply
      // credit blocks here until this transaction commits (or rolls back),
      // then re-reads the now-decremented balance — without the lock, two
      // concurrent reads could both see the same pre-decrement balance and
      // both apply it, consuming it twice.
      const [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for("update");
      if (customer && customer.customerCredits > 0n && subtotal > 0n) {
        creditApplied = customer.customerCredits < subtotal ? customer.customerCredits : subtotal;
      }
    }

    const total = subtotal - creditApplied;
    const now = new Date();
    const number = await allocateInvoiceNumber(tx, now.getUTCFullYear());

    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        status: "draft",
        currency,
        subtotal,
        total,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        dueAt: input.dueAt,
        provider: input.provider,
      })
      .returning();

    const lineValues = [...input.lines];
    if (creditApplied > 0n) {
      lineValues.push({
        kind: "credit",
        description: "Credit applied from a prior plan change",
        unitAmount: -creditApplied,
        amount: -creditApplied,
      });
    }

    const insertedLines = await tx
      .insert(invoiceLines)
      .values(
        lineValues.map((line) => ({
          invoiceId: invoice.id,
          kind: line.kind,
          description: line.description,
          quantity: line.quantity ?? 1,
          unitAmount: line.unitAmount,
          amount: line.amount,
          planId: line.planId,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
        })),
      )
      .returning();

    if (creditApplied > 0n) {
      await tx
        .update(customers)
        .set({ customerCredits: sql`${customers.customerCredits} - ${creditApplied}` })
        .where(eq(customers.id, input.customerId));
    }

    if (total === 0n) {
      const [paidInvoice] = await tx
        .update(invoices)
        .set({ status: "paid", paidAt: now, amountPaid: 0n })
        .where(eq(invoices.id, invoice.id))
        .returning();
      return { invoice: paidInvoice, lines: insertedLines, created: true };
    }

    const { entry } = await postEntry(tx, {
      occurredAt: now,
      description: `Invoice ${number} issued`,
      idempotencyKey: `invoice:${invoice.id}:issued`,
      postings: [
        { accountCode: chartOfAccounts.receivable(currency), amount: total, currency },
        { accountCode: chartOfAccounts.revenue(currency), amount: -total, currency },
      ],
    });

    const [openInvoice] = await tx
      .update(invoices)
      .set({ status: "open", issuedEntryId: entry.id })
      .where(eq(invoices.id, invoice.id))
      .returning();

    return { invoice: openInvoice, lines: insertedLines, created: true };
  });
}
