import type { NormalisedEvent } from "@/providers/types";

/**
 * JSON can't carry `bigint` or `Date`. Used both by the fake provider's
 * signed webhook bodies and by `webhook_events.payload`, which stores a
 * normalised event so a failed handler can be retried later without
 * re-fetching or re-deriving it from the provider's raw body.
 */
export function serialiseNormalisedEvent(event: NormalisedEvent): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(event, (_key, value) => {
      if (typeof value === "bigint") {
        return { __type: "bigint", value: value.toString() };
      }
      return value;
    }),
  ) as Record<string, unknown>;
}

export function deserialiseNormalisedEvent(payload: unknown): NormalisedEvent {
  const revived = JSON.parse(JSON.stringify(payload), (_key, value) => {
    if (value && typeof value === "object" && value.__type === "bigint") {
      return BigInt(value.value);
    }
    return value;
  }) as Record<string, unknown>;

  return { ...revived, occurredAt: new Date(revived.occurredAt as string) } as unknown as NormalisedEvent;
}
