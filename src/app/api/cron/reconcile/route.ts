import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { reconcile } from "@/jobs/reconcile";
import { buildLiveProviders } from "@/providers/registry";

async function handler(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summaries = await reconcile(db, buildLiveProviders("api/cron/reconcile"));

  return Response.json({ ok: true, summaries });
}

// Vercel Cron triggers with a GET request; POST is kept for local `curl` testing and existing tests.
export const GET = handler;
export const POST = handler;
