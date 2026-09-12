import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { recoverSubscriptionForPaidInvoice } from "@/core/billing/dunning/recover";
import { markInvoicePaid } from "@/core/billing/invoices/pay";
import { chartOfAccounts, ensureChartOfAccounts, postEntry } from "@/core/ledger";
import { customers, invoices, payments } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";

type PaymentSucceededEvent = Extract<NormalisedEvent, { type: "payment.succeeded" }>;

async function resolveCustomerId(db: DbOrTx, provider: ProviderId, customerRef?: string): Promise<string | null> {
  if (!customerRef) {
    return null;
  }
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(sql`${customers.providerRefs} ->> ${provider} = ${customerRef}`);
  return row?.id ?? null;
}

/**
 * Debits the provider's clearing account and credits revenue for the gross
 * amount; if a fee was reported, a second pair of postings moves it from
 * clearing to the provider's fees account. Both go through `postEntry`
 * keyed on `payment:{provider}:{ref}`, so replaying the same event posts
 * nothing twice. The `payments` row is upserted by (provider, provider_ref)
 * for the same reason.
 *
 * M3 resolution: if `event.providerRef` matches an `open` invoice's
 * `provider_ref` (set proactively when billing-kit initiates a charge for
 * that invoice — see `attemptInvoicePayment`), this is an invoice payment:
 * post against `receivable` and mark the invoice paid instead of the
 * one-off cash/revenue posting below.
 */
export async function handlePaymentSucceeded(
  db: DbOrTx,
  provider: ProviderId,
  event: PaymentSucceededEvent,
): Promise<void> {
  const currency = event.money.currency.toUpperCase();
  await ensureChartOfAccounts(db, currency);

  // Not filtered to `status = "open"`: a replay of an event that already
  // paid this invoice must still be recognized as invoice-linked (and
  // handled by the idempotent `markInvoicePaid`/`recoverSubscriptionForPaidInvoice`
  // path below) rather than falling through to the one-off posting and
  // double-crediting revenue. `void`/`uncollectible` invoices are excluded
  // — a payment succeeding against a write-off is a reconciliation
  // situation this handler does not attempt to resolve on its own.
  const [linkedInvoice] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.provider, provider),
        eq(invoices.providerRef, event.providerRef),
        sql`${invoices.status} in ('open', 'paid')`,
      ),
    );

  if (linkedInvoice) {
    const paid = await markInvoicePaid(db, linkedInvoice, {
      provider,
      providerRef: event.providerRef,
      fee: event.fee,
      occurredAt: event.occurredAt,
    });

    const customerId = await resolveCustomerId(db, provider, event.customerRef);
    await db
      .insert(payments)
      .values({
        provider,
        providerRef: event.providerRef,
        customerId: customerId ?? paid.customerId,
        amount: event.money.amount,
        currency,
        fee: event.fee?.amount ?? 0n,
        status: "succeeded",
        entryId: paid.paidEntryId,
        occurredAt: event.occurredAt,
      })
      .onConflictDoUpdate({
        target: [payments.provider, payments.providerRef],
        set: { status: "succeeded", entryId: paid.paidEntryId },
      });

    await recoverSubscriptionForPaidInvoice(db, paid);
    return;
  }

  const postingsInput = [
    { accountCode: chartOfAccounts.cash(provider, currency), amount: event.money.amount, currency },
    { accountCode: chartOfAccounts.revenue(currency), amount: -event.money.amount, currency },
  ];

  if (event.fee && event.fee.amount > 0n) {
    postingsInput.push(
      { accountCode: chartOfAccounts.fees(provider, currency), amount: event.fee.amount, currency },
      { accountCode: chartOfAccounts.cash(provider, currency), amount: -event.fee.amount, currency },
    );
  }

  const { entry } = await postEntry(db, {
    occurredAt: event.occurredAt,
    description: `${provider} payment ${event.providerRef}`,
    idempotencyKey: `payment:${provider}:${event.providerRef}`,
    postings: postingsInput,
  });

  const customerId = await resolveCustomerId(db, provider, event.customerRef);

  await db
    .insert(payments)
    .values({
      provider,
      providerRef: event.providerRef,
      customerId,
      amount: event.money.amount,
      currency,
      fee: event.fee?.amount ?? 0n,
      status: "succeeded",
      entryId: entry.id,
      occurredAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [payments.provider, payments.providerRef],
      set: {
        customerId,
        amount: event.money.amount,
        currency,
        fee: event.fee?.amount ?? 0n,
        status: "succeeded",
        entryId: entry.id,
      },
    });
}

/** Exported for the failed-payment handler, which needs the same status-guarded lookup. */
export async function findPayment(db: DbOrTx, provider: ProviderId, providerRef: string) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.providerRef, providerRef)));
  return payment;
}
