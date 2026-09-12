import type { DbOrTx } from "@/db/client";
import { postSettlement } from "@/core/webhooks/settlement";
import type { NormalisedEvent, ProviderId } from "@/providers/types";

type SettlementPostedEvent = Extract<NormalisedEvent, { type: "settlement.posted" }>;

/** Same idempotent path the reconciliation job uses, keyed on `settlement:{provider}:{id}`. */
export async function handleSettlementPosted(
  db: DbOrTx,
  provider: ProviderId,
  event: SettlementPostedEvent,
): Promise<void> {
  await postSettlement(db, {
    provider,
    settlementId: event.settlementId,
    gross: event.money,
    fee: event.fee,
    settledAt: event.occurredAt,
  });
}
