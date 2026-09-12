import type { DbOrTx } from "@/db/client";
import type { PaymentProvider, ProviderId } from "@/providers/types";
import { extractRawEnvelope } from "./envelope";
import { ingestEvent, ingestUnknownEvent, type IngestResult } from "./ingest-event";

export type WebhookOutcome =
  | { status: 400; body: { error: string } }
  | { status: 200; body: { ok: true; ignored: true } }
  | { status: 200; body: { ok: true; results: IngestResult[] } };

/**
 * The provider-agnostic core of `POST /api/webhooks/[provider]`, factored
 * out so tests can call it directly with a `FakeProvider` or a real adapter
 * pointed at a fixture, without going through an HTTP server.
 *
 * Verifies the raw body against the header signature first (never parses
 * before verifying); a bad signature is the only case that gets a non-200,
 * so a provider's retry logic only kicks in on the failure that actually
 * needs a retry.
 */
export async function handleWebhookRequest(
  db: DbOrTx,
  provider: PaymentProvider,
  providerId: ProviderId,
  rawBody: string,
  headers: Headers,
): Promise<WebhookOutcome> {
  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    return { status: 400, body: { error: "Invalid signature" } };
  }

  const events = provider.parseEvents(rawBody);

  if (events.length === 0) {
    const envelope = extractRawEnvelope(providerId, rawBody);
    await ingestUnknownEvent(db, providerId, envelope);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const results: IngestResult[] = [];
  for (const event of events) {
    results.push(await ingestEvent(db, providerId, event));
  }

  return { status: 200, body: { ok: true, results } };
}
