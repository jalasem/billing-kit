"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getBalance, recomputeBalance } from "@/core/ledger";
import { requireOperatorSession } from "@/core/auth";
import { db } from "@/db/client";
import { auditLog, reconciliationFlags } from "@/db/schema";
import { reconcile } from "@/jobs/reconcile";
import { replayWebhookEvent } from "@/jobs/retry-webhooks";
import { buildLiveProviders, createProvider } from "@/providers/registry";

async function writeAudit(actor: string, action: string, subject: string, details: Record<string, unknown>): Promise<void> {
  await db.insert(auditLog).values({ actor, action, subject, details });
}

/** Re-runs one webhook event's handler regardless of its current outcome — every admin mutation re-checks `is_operator` here, on the server. */
export async function replayWebhookAction(formData: FormData): Promise<void> {
  const session = await requireOperatorSession();
  const id = String(formData.get("id") ?? "");

  const result = await replayWebhookEvent(db, id);
  await writeAudit(session.email, "webhook_event.replay", id, { result });

  redirect(`/admin/webhooks?replayed=${id}`);
}

export async function resolveReconciliationFlagAction(formData: FormData): Promise<void> {
  const session = await requireOperatorSession();
  const id = String(formData.get("id") ?? "");

  await db.update(reconciliationFlags).set({ resolvedAt: new Date() }).where(eq(reconciliationFlags.id, id));
  await writeAudit(session.email, "reconciliation_flag.resolve", id, {});

  redirect(`/admin/reconciliation?resolved=${id}`);
}

/** Calls the reconciliation job directly (not the cron HTTP route) — includes the `fake` provider so this is meaningfully testable in development and CI. */
export async function runReconciliationNowAction(): Promise<void> {
  const session = await requireOperatorSession();

  const providers = { ...buildLiveProviders("admin/reconciliation"), fake: createProvider("fake") };
  const summary = await reconcile(db, providers);
  await writeAudit(session.email, "reconciliation.run", "reconciliation", summary);

  redirect("/admin/reconciliation?ran=1");
}

/** Compares the cached balance against one recomputed from postings and shows both — see `/admin/ledger/accounts/[code]`. */
export async function verifyAccountBalanceAction(formData: FormData): Promise<void> {
  const session = await requireOperatorSession();
  const code = String(formData.get("code") ?? "");

  const [cached, recomputed] = await Promise.all([getBalance(db, code), recomputeBalance(db, code)]);
  await writeAudit(session.email, "ledger.account.verify", code, { cached: cached.toString(), recomputed: recomputed.toString() });

  redirect(`/admin/ledger/accounts/${encodeURIComponent(code)}?cached=${cached}&recomputed=${recomputed}`);
}
