import { isAuthorizedCronRequest } from "@/core/cron-auth";
import { db } from "@/db/client";
import { runRenewals } from "@/jobs/renew";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runRenewals(db);
  return Response.json({ ok: true, summary });
}
