import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
    has: (name: string) => store.has(name),
    clear: () => store.clear(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieJar,
}));

import { eq } from "drizzle-orm";
import { UnauthorizedError } from "@/core/auth/errors";
import { createSessionRow } from "@/core/auth/session";
import { db } from "@/db/client";
import { reconciliationFlags, webhookEvents } from "@/db/schema";
import { resetM4Tables } from "@/test/reset-db";
import { replayWebhookAction, resolveReconciliationFlagAction, runReconciliationNowAction } from "./actions";

async function loginAs(email: string, isOperator: boolean): Promise<void> {
  const session = await createSessionRow(db, { email, customerId: null, isOperator });
  cookieJar.set("bk_session", session.id);
}

function formData(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

beforeEach(async () => {
  await resetM4Tables(db);
  cookieJar.clear();
});

describe("admin server action authorization", () => {
  it("a non-operator session cannot replay a webhook event", async () => {
    const [event] = await db
      .insert(webhookEvents)
      .values({ provider: "fake", eventId: "evt_1", type: "payment.succeeded", payload: {} })
      .returning();

    await loginAs("customer@example.com", false);
    await expect(replayWebhookAction(formData({ id: event.id }))).rejects.toThrow(UnauthorizedError);
  });

  it("a session with no operator flag cannot resolve a reconciliation flag", async () => {
    const [flag] = await db
      .insert(reconciliationFlags)
      .values({ kind: "unsettled_payment", provider: "fake", ref: "ref_1", details: {} })
      .returning();

    await loginAs("customer@example.com", false);
    await expect(resolveReconciliationFlagAction(formData({ id: flag.id }))).rejects.toThrow(UnauthorizedError);

    const [unchanged] = await db.select().from(reconciliationFlags).where(eq(reconciliationFlags.id, flag.id));
    expect(unchanged.resolvedAt).toBeNull();
  });

  it("an unauthenticated request cannot run reconciliation", async () => {
    await expect(runReconciliationNowAction()).rejects.toThrow(UnauthorizedError);
  });

  it("an operator session can resolve a reconciliation flag", async () => {
    const [flag] = await db
      .insert(reconciliationFlags)
      .values({ kind: "unsettled_payment", provider: "fake", ref: "ref_2", details: {} })
      .returning();

    await loginAs("ops@example.com", true);
    await expect(resolveReconciliationFlagAction(formData({ id: flag.id }))).rejects.toThrow(/NEXT_REDIRECT/);

    const [resolved] = await db.select().from(reconciliationFlags).where(eq(reconciliationFlags.id, flag.id));
    expect(resolved.resolvedAt).not.toBeNull();
  });
});
