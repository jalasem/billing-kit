import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { webhookEvents, type WebhookEvent } from "@/db/schema";
import type { NormalisedEvent, ProviderId } from "@/providers/types";
import { dispatchNormalisedEvent } from "./dispatch";
import { serialiseNormalisedEvent } from "./serialize";

/** After this many failed attempts, a redelivery is treated as a duplicate rather than retried again inline. `retryFailedWebhooks` uses the same bound. */
export const MAX_INGEST_ATTEMPTS = 5;

export interface IngestResult {
  duplicate: boolean;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records one normalised event in `webhook_events` (unique on
 * (provider, event_id)) and runs its handler, all in one transaction with
 * the handler nested in its own savepoint. That nesting is the whole point:
 * if the handler throws, only the savepoint rolls back (the ledger/payments
 * writes it attempted), while the outer transaction still commits the
 * `webhook_events` row with `error` set and `attempts` incremented,
 * `processed_at` left `NULL`. A transient failure is therefore recorded but
 * not "consumed" — a later redelivery (or `retryFailedWebhooks`) sees
 * `processed_at IS NULL` and tries the handler again, bounded by
 * `MAX_INGEST_ATTEMPTS`, instead of silently dropping the event forever the
 * way treating that first insert as the definitive dedupe record would.
 */
export async function ingestEvent(db: DbOrTx, provider: ProviderId, event: NormalisedEvent): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(webhookEvents)
      .values({ provider, eventId: event.providerEventId, type: event.type, payload: serialiseNormalisedEvent(event) })
      .onConflictDoNothing()
      .returning();

    let row = inserted;
    if (!row) {
      const [existing] = await tx
        .select()
        .from(webhookEvents)
        .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, event.providerEventId)));

      // Only a concurrent transaction that hasn't committed yet could make
      // this happen, and Postgres blocks this insert until it does (see the
      // concurrent-delivery test) — so by the time we get here, it exists.
      if (!existing) {
        return { duplicate: true };
      }
      row = existing;

      if (row.processedAt !== null) {
        return { duplicate: true };
      }
      if (row.attempts >= MAX_INGEST_ATTEMPTS) {
        return { duplicate: true, error: row.error ?? undefined };
      }
    }

    return runHandlerAndRecord(tx, provider, event, row);
  });
}

/**
 * Runs the handler for one already-inserted `webhook_events` row, in a
 * savepoint of the caller's transaction, and updates that row with the
 * outcome. Shared by `ingestEvent` (first attempt or an inline retry on
 * redelivery) and `retryFailedWebhooks` (the cron-driven retry).
 */
export async function runHandlerAndRecord(
  db: DbOrTx,
  provider: ProviderId,
  event: NormalisedEvent,
  row: WebhookEvent,
): Promise<IngestResult> {
  try {
    await db.transaction((savepoint) => dispatchNormalisedEvent(savepoint, provider, event));
    await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, row.id));
    return { duplicate: false };
  } catch (error) {
    const message = errorMessage(error);
    await db
      .update(webhookEvents)
      .set({ error: message, attempts: row.attempts + 1 })
      .where(eq(webhookEvents.id, row.id));
    return { duplicate: false, error: message };
  }
}

/**
 * Records a raw event we could not turn into a `NormalisedEvent`: either a
 * recognized type nothing maps to (`error` omitted — recorded and ignored,
 * `processed_at` set immediately, nothing to retry), or a payload that
 * failed to parse/validate at all (`error` set, `type` is the provider's
 * type when it could be read at all, else `"unparseable"`). Either way
 * there is no handler to run, so this never touches `payload`/`attempts`.
 */
export async function ingestUnknownEvent(
  db: DbOrTx,
  provider: ProviderId,
  envelope: { eventId: string; type: string },
  error?: string,
): Promise<IngestResult> {
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ provider, eventId: envelope.eventId, type: envelope.type, processedAt: new Date(), error: error ?? null })
    .onConflictDoNothing()
    .returning();

  return { duplicate: !inserted, error };
}
