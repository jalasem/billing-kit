import { and, isNull, lt, sql } from "drizzle-orm";
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
