import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { runDunning } from "@/jobs/dunning";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runDunning(db);
  return Response.json({ ok: true, summary });
}
