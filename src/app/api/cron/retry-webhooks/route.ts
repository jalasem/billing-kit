import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { retryFailedWebhooks } from "@/jobs/retry-webhooks";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await retryFailedWebhooks(db);
  return Response.json({ ok: true, summary });
}
