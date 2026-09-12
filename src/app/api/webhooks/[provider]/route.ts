import { db } from "@/db/client";
import { handleWebhookRequest } from "@/core/webhooks";
import { createProvider, isProviderId } from "@/providers/registry";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider: providerParam } = await context.params;

  if (!isProviderId(providerParam)) {
    return Response.json({ error: `Unknown provider: ${providerParam}` }, { status: 404 });
  }

  // Read as text, never JSON first: signature verification needs the exact bytes the provider signed.
  const rawBody = await request.text();
  const provider = createProvider(providerParam);

  const outcome = await handleWebhookRequest(db, provider, providerParam, rawBody, request.headers);
  return Response.json(outcome.body, { status: outcome.status });
}
