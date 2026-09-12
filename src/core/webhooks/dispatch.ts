import type { DbOrTx } from "@/db/client";
import type { NormalisedEvent, ProviderId } from "@/providers/types";
import { handlePaymentFailed } from "./handlers/payment-failed";
import { handlePaymentSucceeded } from "./handlers/payment-succeeded";
import { handleRefundSucceeded } from "./handlers/refund-succeeded";
import { handleSettlementPosted } from "./handlers/settlement-posted";
import { handleSubscriptionUpdated } from "./handlers/subscription-updated";

/** Routes one normalised event to its handler. Exhaustive over `NormalisedEvent["type"]`. */
export async function dispatchNormalisedEvent(db: DbOrTx, provider: ProviderId, event: NormalisedEvent): Promise<void> {
  switch (event.type) {
    case "payment.succeeded":
      return handlePaymentSucceeded(db, provider, event);
    case "payment.failed":
      return handlePaymentFailed(db, provider, event);
    case "refund.succeeded":
      return handleRefundSucceeded(db, provider, event);
    case "subscription.updated":
      return handleSubscriptionUpdated(provider, event);
    case "settlement.posted":
      return handleSettlementPosted(db, provider, event);
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled normalised event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
