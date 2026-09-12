import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { reconcile } from "@/jobs/reconcile";
import { buildLiveProviders } from "@/providers/registry";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summaries = await reconcile(db, buildLiveProviders("api/cron/reconcile"));

  return Response.json({ ok: true, summaries });
}
