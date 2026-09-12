import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { runRenewals } from "@/jobs/renew";

async function handler(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runRenewals(db);
  return Response.json({ ok: true, summary });
}

// Vercel Cron triggers with a GET request; POST is kept for local `curl` testing and existing tests.
export const GET = handler;
export const POST = handler;
