import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { chartOfAccounts, ensureChartOfAccounts, postEntry } from "@/core/ledger";
import { customers, payments } from "@/db/schema";
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
 */
export async function handlePaymentSucceeded(
  db: DbOrTx,
  provider: ProviderId,
  event: PaymentSucceededEvent,
): Promise<void> {
  const currency = event.money.currency.toUpperCase();
  await ensureChartOfAccounts(db, currency);

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
