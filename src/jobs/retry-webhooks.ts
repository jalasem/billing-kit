import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { MAX_INGEST_ATTEMPTS, runHandlerAndRecord, type IngestResult } from "@/core/webhooks/ingest-event";
import { deserialiseNormalisedEvent } from "@/core/webhooks/serialize";
import type { DbOrTx } from "@/db/client";
import { webhookEvents } from "@/db/schema";

export interface RetryWebhooksSummary {
  attempted: number;
  succeeded: number;
  stillFailing: number;
}

/**
 * Re-runs the handler for every `webhook_events` row that failed and hasn't
 * exhausted `MAX_INGEST_ATTEMPTS`: `processed_at IS NULL` (never
 * succeeded), `attempts < MAX_INGEST_ATTEMPTS` (still worth trying), and a
 * non-empty `payload` (there is something to retry — an unmapped or
 * unparseable event has none, since there was never a handler to run).
 * Each row is retried in its own transaction via `runHandlerAndRecord`, the
 * same function a redelivered webhook uses inline, so the outcome (and the
 * row it leaves behind) is identical either way.
 */
export async function retryFailedWebhooks(db: DbOrTx, limit = 100): Promise<RetryWebhooksSummary> {
  const rows = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.attempts, MAX_INGEST_ATTEMPTS),
        sql`${webhookEvents.payload} <> '{}'::jsonb`,
      ),
    )
    .limit(limit);

  const summary: RetryWebhooksSummary = { attempted: 0, succeeded: 0, stillFailing: 0 };

  for (const row of rows) {
    const event = deserialiseNormalisedEvent(row.payload);
    summary.attempted += 1;

    const result: IngestResult = await db.transaction((tx) => runHandlerAndRecord(tx, row.provider, event, row));

    if (result.error) {
      summary.stillFailing += 1;
    } else {
      summary.succeeded += 1;
    }
  }

  return summary;
}

/**
 * Re-runs one specific `webhook_events` row through its handler, regardless
 * of its current `processed_at`/`attempts` state — this is the admin
 * "Replay" button, not the bounded cron retry above. Safe to call on an
 * already-processed row: handlers are pure functions of (event, state), so
 * a replay is a no-op the same way a provider's own redelivery is (M2
 * invariant 3). Returns `{ skipped: true }` for a row with nothing to
 * retry (an unmapped or unparseable event never had a handler to run).
 */
export async function replayWebhookEvent(db: DbOrTx, id: string): Promise<IngestResult | { skipped: true }> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
  if (!row) {
    throw new Error(`Unknown webhook event: ${id}`);
  }
  if (!row.payload || Object.keys(row.payload as Record<string, unknown>).length === 0) {
    return { skipped: true };
  }

  const event = deserialiseNormalisedEvent(row.payload);
  return db.transaction((tx) => runHandlerAndRecord(tx, row.provider, event, row));
}
