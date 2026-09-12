import type { DbOrTx } from "@/db/client";
import { payments } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";

type PaymentFailedEvent = Extract<NormalisedEvent, { type: "payment.failed" }>;

/** No ledger entry: a failed payment never moved money. */
export async function handlePaymentFailed(db: DbOrTx, provider: ProviderId, event: PaymentFailedEvent): Promise<void> {
  await db
    .insert(payments)
    .values({
      provider,
      providerRef: event.providerRef,
      amount: event.money.amount,
      currency: event.money.currency.toUpperCase(),
      status: "failed",
      occurredAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: [payments.provider, payments.providerRef],
      set: { status: "failed" },
    });
}
