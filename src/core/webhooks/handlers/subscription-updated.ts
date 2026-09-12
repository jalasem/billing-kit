import type { NormalisedEvent, ProviderId } from "@/providers/types";

type SubscriptionUpdatedEvent = Extract<NormalisedEvent, { type: "subscription.updated" }>;

/**
 * Subscriptions land in M3. For now the event is already durably recorded
 * in `webhook_events` by `ingestEvent`; this handler is a deliberate no-op
 * beyond logging, so replaying it is trivially safe.
 */
export function handleSubscriptionUpdated(provider: ProviderId, event: SubscriptionUpdatedEvent): void {
  console.log(
    `[webhooks] ${provider} subscription.updated recorded (subscriptions land in M3): ` +
      `${event.providerSubscriptionId} -> ${event.status}`,
  );
}
