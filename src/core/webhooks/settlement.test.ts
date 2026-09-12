import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { entries, settlements } from "@/db/schema";
import { resetBillingTables } from "@/test/reset-db";
import { postSettlement } from "./settlement";

beforeEach(async () => {
  await resetBillingTables(db);
});

describe("postSettlement", () => {
  it("reports created: true once and created: false on a same-provider replay", async () => {
    const input = {
      provider: "fake" as const,
      settlementId: "stl_replay",
      gross: { amount: 10000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const first = await postSettlement(db, input);
    const second = await postSettlement(db, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const rows = await db.select().from(settlements).where(eq(settlements.settlementId, "stl_replay"));
    expect(rows).toHaveLength(1);
  });

  it("under a race, exactly one of two concurrent calls reports created: true, and exactly one settlement/entry exists", async () => {
    const input = {
      provider: "fake" as const,
      settlementId: "stl_concurrent",
      gross: { amount: 25000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    const [a, b] = await Promise.all([postSettlement(db, input), postSettlement(db, input)]);

    const createdCount = [a.created, b.created].filter(Boolean).length;
    expect(createdCount).toBe(1);

    const settlementRows = await db.select().from(settlements).where(eq(settlements.settlementId, "stl_concurrent"));
    expect(settlementRows).toHaveLength(1);

    const entryRows = await db
      .select()
      .from(entries)
      .where(eq(entries.idempotencyKey, "settlement:fake:stl_concurrent"));
    expect(entryRows).toHaveLength(1);

    expect(await getBalance(db, "bank:NGN")).toBe(25000n);
  });
});
