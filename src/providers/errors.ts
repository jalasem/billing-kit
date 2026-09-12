import type { ProviderId } from "./types";

/**
 * Thrown when a provider's webhook payload does not have the shape a
 * mapping function needs (a missing/invalid amount, currency, id, fee, or
 * timestamp). Callers (the webhook route) catch this specifically so a
 * malformed payload becomes a recorded, ignored event instead of a 500 or
 * an unhandled `TypeError` from a nested property access.
 */
export class ProviderPayloadError extends Error {
  readonly provider: ProviderId;
  readonly eventType: string;

  constructor(provider: ProviderId, eventType: string, cause: unknown) {
    super(`Invalid ${provider} payload for event type "${eventType}": ${causeMessage(cause)}`, { cause });
    this.name = "ProviderPayloadError";
    this.provider = provider;
    this.eventType = eventType;
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
