import { db } from "@/db/client";
import { reconcile } from "@/jobs/reconcile";
import { createProvider } from "@/providers/registry";

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET || authorization !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summaries = await reconcile(db, {
    stripe: createProvider("stripe"),
    paystack: createProvider("paystack"),
  });

  return Response.json({ ok: true, summaries });
}
