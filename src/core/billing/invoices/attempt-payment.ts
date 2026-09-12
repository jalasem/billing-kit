import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { invoices, type Customer, type Invoice } from "@/db/schema";
import type { PaymentProvider } from "@/providers/types";
import { markInvoicePaid } from "./pay";

export interface AttemptPaymentResult {
  /** False when no charge was even attempted (no saved method, or no provider customer id yet) — "wait for the provider", not a failure. */
  attempted: boolean;
  succeeded: boolean;
  providerRef?: string;
  error?: string;
  /** The invoice as it stands after this call — updated (status `paid`, etc.) on success, unchanged otherwise. Callers must use this, not their own stale copy. */
  invoice: Invoice;
}

/**
 * Kit-mode payment collection: charges the customer's saved method for an
 * open invoice's total and, on success, posts the "paid" entry through the
 * same `markInvoicePaid` path a provider webhook would use. Used by
 * subscription creation, renewal, and the dunning job — anywhere billing-kit
 * (rather than the provider) is the one retrying.
 *
 * Returns `{ attempted: false, succeeded: false }` without attempting a
 * charge when the customer has no saved method or no provider customer id
 * yet — that is "nothing to attempt" (provider mode, or a brand new
 * customer), not a charge failure, and callers must not start dunning over
 * it (see `attempted && !succeeded` at each call site).
 */
export async function attemptInvoicePayment(
  db: DbOrTx,
  provider: PaymentProvider,
  invoice: Invoice,
  customer: Customer,
): Promise<AttemptPaymentResult> {
  if (invoice.status === "paid") {
    return { attempted: false, succeeded: true, invoice };
  }

  if (!customer.defaultAuthorization) {
    return { attempted: false, succeeded: false, invoice };
  }

  const providerCustomerId = customer.providerRefs[provider.id];
  if (!providerCustomerId) {
    return {
      attempted: false,
      succeeded: false,
      invoice,
      error: `customer ${customer.id} has no ${provider.id} provider id`,
    };
  }

  try {
    const result = await provider.chargeSavedMethod({
      providerCustomerId,
      authorization: customer.defaultAuthorization,
      money: { amount: invoice.total, currency: invoice.currency },
      reference: `inv_${invoice.id}`,
    });

    // Recorded regardless of outcome: a provider that resolves this charge
    // asynchronously (its own retry, or a delayed webhook) reports back
    // against this same reference, and `handlePaymentSucceeded` /
    // `handlePaymentFailed` match an invoice-linked event by provider_ref.
    let current = invoice;
    if (!invoice.providerRef) {
      const [updated] = await db
        .update(invoices)
        .set({ providerRef: result.providerRef })
        .where(eq(invoices.id, invoice.id))
        .returning();
      current = updated;
    }

    if (result.status !== "succeeded") {
      return { attempted: true, succeeded: false, providerRef: result.providerRef, error: `charge ${result.status}`, invoice: current };
    }

    const paid = await markInvoicePaid(db, current, {
      provider: provider.id,
      providerRef: result.providerRef,
      occurredAt: new Date(),
    });
    return { attempted: true, succeeded: true, providerRef: result.providerRef, invoice: paid };
  } catch (error) {
    return { attempted: true, succeeded: false, error: error instanceof Error ? error.message : String(error), invoice };
  }
}
