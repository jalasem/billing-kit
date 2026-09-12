import { extractPaystackEnvelope } from "@/providers/paystack/mapping";
import { extractStripeEnvelope } from "@/providers/stripe/mapping";
import type { ProviderId } from "@/providers/types";

/**
 * A cheap peek at a raw webhook body's id and type, used only when
 * `parseEvents` returned nothing for it (an event type we don't map). The
 * webhook route still needs to record that it saw and ignored the event.
 */
export function extractRawEnvelope(provider: ProviderId, rawBody: string): { eventId: string; type: string } {
  switch (provider) {
    case "stripe":
      return extractStripeEnvelope(rawBody);
    case "paystack":
      return extractPaystackEnvelope(rawBody);
    case "fake": {
      const [first] = JSON.parse(rawBody) as Array<{ providerEventId?: string; type?: string }>;
      return { eventId: first?.providerEventId ?? "unknown", type: first?.type ?? "unknown" };
    }
  }
}
