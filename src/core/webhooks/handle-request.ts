import type { DbOrTx } from "@/db/client";
import type { PaymentProvider, ProviderId } from "@/providers/types";
import { safeExtractRawEnvelope } from "./envelope";
import { ingestEvent, ingestUnknownEvent, type IngestResult } from "./ingest-event";

export type WebhookOutcome =
  | { status: 400; body: { error: string } }
  | { status: 200; body: { ok: true; ignored: true } }
  | { status: 200; body: { ok: true; results: IngestResult[] } };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The provider-agnostic core of `POST /api/webhooks/[provider]`, factored
 * out so tests can call it directly with a `FakeProvider` or a real adapter
 * pointed at a fixture, without going through an HTTP server.
 *
 * Verifies the raw body against the header signature first (never parses
 * before verifying); a bad signature is the only case that gets a non-200,
 * so a provider's retry logic only kicks in on the failure that actually
 * needs a retry. Once the signature is valid, nothing else can produce a
 * non-200: `parseEvents` throwing (a malformed or unrecognized-shape
 * payload — see `ProviderPayloadError`) is caught here and recorded as an
 * ignored, errored event rather than surfacing as a 500, so a bad payload
 * doesn't turn into an endless provider retry storm either.
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

  let events;
  try {
    events = provider.parseEvents(rawBody);
  } catch (error) {
    const envelope = safeExtractRawEnvelope(providerId, rawBody);
    await ingestUnknownEvent(db, providerId, envelope, errorMessage(error));
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (events.length === 0) {
    const envelope = safeExtractRawEnvelope(providerId, rawBody);
    await ingestUnknownEvent(db, providerId, envelope);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const results: IngestResult[] = [];
  for (const event of events) {
    results.push(await ingestEvent(db, providerId, event));
  }

  return { status: 200, body: { ok: true, results } };
}
