import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";
import { dispatchNormalisedEvent } from "./dispatch";

export interface IngestResult {
  duplicate: boolean;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records one normalised event in `webhook_events` (on conflict on
 * (provider, event_id), do nothing — a replay) and, the first time, runs
 * its handler in its own transaction.
 *
 * The `webhook_events` row is written with its own statement, outside the
 * handler's transaction, on purpose: if the handler throws, we still want
 * the row to exist with `error` set (so the event is visibly recorded, not
 * silently retried forever by the provider) rather than have the whole
 * bookkeeping insert roll back with it. See the webhook route for why that
 * matters — providers retry on anything but 200, so recording the error and
 * still returning 200 is what stops a bad event from becoming a retry storm.
 */
export async function ingestEvent(db: DbOrTx, provider: ProviderId, event: NormalisedEvent): Promise<IngestResult> {
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ provider, eventId: event.providerEventId, type: event.type })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    return { duplicate: true };
  }

  try {
    await db.transaction((tx) => dispatchNormalisedEvent(tx, provider, event));
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, inserted.id));
    return { duplicate: false };
  } catch (error) {
    const message = errorMessage(error);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: message })
      .where(eq(webhookEvents.id, inserted.id));
    return { duplicate: false, error: message };
  }
}

/** Records a raw event whose type we don't map to a `NormalisedEvent`. Recorded and immediately marked processed: there is nothing to dispatch. */
export async function ingestUnknownEvent(
  db: DbOrTx,
  provider: ProviderId,
  envelope: { eventId: string; type: string },
): Promise<IngestResult> {
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ provider, eventId: envelope.eventId, type: envelope.type, processedAt: new Date() })
    .onConflictDoNothing()
    .returning();

  return { duplicate: !inserted };
}
