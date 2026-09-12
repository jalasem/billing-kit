import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { runDunning } from "@/jobs/dunning";

async function handler(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runDunning(db);
  return Response.json({ ok: true, summary });
}

// Vercel Cron triggers with a GET request; POST is kept for local `curl` testing and existing tests.
export const GET = handler;
export const POST = handler;
