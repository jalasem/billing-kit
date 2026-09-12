import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { providerEnum } from "./enums";

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    // The normalised event, bigint/Date-safe encoded (see
    // src/core/webhooks/serialize.ts), so a failed handler can be retried
    // later without re-deriving the event from the provider's raw body.
    // Empty for events with nothing to retry (unmapped or unparseable).
    payload: jsonb("payload").notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(sql`0`),
  },
  (table) => [unique("webhook_events_provider_event_id_unique").on(table.provider, table.eventId)],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
