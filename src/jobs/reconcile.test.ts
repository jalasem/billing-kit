import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { payments, reconciliationFlags, settlements } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { resetBillingTables } from "@/test/reset-db";
import { reconcile, reconcileProvider } from "./reconcile";

const NOW = new Date("2026-02-01T00:00:00.000Z");

async function insertSucceededPayment(input: {
  providerRef: string;
  amount: bigint;
  occurredAt: Date;
}): Promise<void> {
  await db.insert(payments).values({
    provider: "fake",
    providerRef: input.providerRef,
    amount: input.amount,
    currency: "NGN",
    status: "succeeded",
    occurredAt: input.occurredAt,
  });
}

beforeEach(async () => {
  await resetBillingTables(db);
});

describe("reconcileProvider", () => {
  it("posts a settlement into the ledger and links payment refs", async () => {
    await insertSucceededPayment({ providerRef: "ch_fake_1", amount: 100000n, occurredAt: NOW });

    const provider = new FakeProvider();
    provider.seedSettlement({
      settlementId: "stl_1",
      money: { amount: 100000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: NOW,
      paymentRefs: ["ch_fake_1"],
    });

    const summary = await reconcileProvider(db, "fake", provider, { from: new Date(0), to: NOW });

    expect(summary.settlementsSeen).toBe(1);
    expect(summary.settlementsPosted).toBe(1);
    expect(summary.unknownSettlementRefFlags).toBe(0);

    const [settlement] = await db.select().from(settlements).where(eq(settlements.settlementId, "stl_1"));
    expect(settlement).toBeDefined();
    expect(settlement.entryId).not.toBeNull();

    expect(await getBalance(db, "bank:NGN")).toBe(100000n);
    expect(await getBalance(db, "cash:fake:NGN")).toBe(-100000n);
  });

  it("running the same window twice creates no new entries or flags", async () => {
    await insertSucceededPayment({ providerRef: "ch_fake_2", amount: 50000n, occurredAt: NOW });

    const provider = new FakeProvider();
    provider.seedSettlement({
      settlementId: "stl_2",
      money: { amount: 50000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: NOW,
      paymentRefs: ["ch_fake_2"],
    });

    const options = { from: new Date(0), to: NOW };
    const first = await reconcileProvider(db, "fake", provider, options);
    const second = await reconcileProvider(db, "fake", provider, options);

    expect(first.settlementsPosted).toBe(1);
    expect(second.settlementsPosted).toBe(0);

    const rows = await db.select().from(settlements).where(eq(settlements.settlementId, "stl_2"));
    expect(rows).toHaveLength(1);
    expect(await getBalance(db, "bank:NGN")).toBe(50000n);
  });

  it("flags a settlement payment ref that matches no payment row, once", async () => {
    const provider = new FakeProvider();
    provider.seedSettlement({
      settlementId: "stl_3",
      money: { amount: 20000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: NOW,
      paymentRefs: ["ch_never_recorded"],
    });

    const options = { from: new Date(0), to: NOW };
    await reconcileProvider(db, "fake", provider, options);
    await reconcileProvider(db, "fake", provider, options);

    const flags = await db
      .select()
      .from(reconciliationFlags)
      .where(and(eq(reconciliationFlags.kind, "unknown_settlement_ref"), eq(reconciliationFlags.ref, "ch_never_recorded")));

    expect(flags).toHaveLength(1);
  });

  it("flags a succeeded payment older than 7 days that appears in no settlement, once", async () => {
    const oldPaymentDate = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    await insertSucceededPayment({ providerRef: "ch_stale", amount: 30000n, occurredAt: oldPaymentDate });

    const provider = new FakeProvider();
    const options = { from: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), to: NOW };

    await reconcileProvider(db, "fake", provider, options);
    await reconcileProvider(db, "fake", provider, options);

    const flags = await db
      .select()
      .from(reconciliationFlags)
      .where(and(eq(reconciliationFlags.kind, "unsettled_payment"), eq(reconciliationFlags.ref, "ch_stale")));

    expect(flags).toHaveLength(1);
  });

  it("does not flag a succeeded payment newer than 7 days, even if unsettled", async () => {
    const recentPaymentDate = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    await insertSucceededPayment({ providerRef: "ch_recent", amount: 30000n, occurredAt: recentPaymentDate });

    const provider = new FakeProvider();
    await reconcileProvider(db, "fake", provider, { from: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), to: NOW });

    const flags = await db
      .select()
      .from(reconciliationFlags)
      .where(and(eq(reconciliationFlags.kind, "unsettled_payment"), eq(reconciliationFlags.ref, "ch_recent")));

    expect(flags).toHaveLength(0);
  });

  it("two concurrent runs over the same gap create no duplicate flags or entries", async () => {
    const provider = new FakeProvider();
    provider.seedSettlement({
      settlementId: "stl_concurrent",
      money: { amount: 40000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
      settledAt: NOW,
      paymentRefs: ["ch_concurrent_unknown"],
    });

    const options = { from: new Date(0), to: NOW };
    const [a, b] = await Promise.all([
      reconcileProvider(db, "fake", provider, options),
      reconcileProvider(db, "fake", provider, options),
    ]);

    // Exactly one of the two runs should get credit for each creation;
    // together they must total exactly one settlement and one flag.
    expect(a.settlementsPosted + b.settlementsPosted).toBe(1);
    expect(a.unknownSettlementRefFlags + b.unknownSettlementRefFlags).toBe(1);

    const settlementRows = await db.select().from(settlements).where(eq(settlements.settlementId, "stl_concurrent"));
    expect(settlementRows).toHaveLength(1);

    const flagRows = await db
      .select()
      .from(reconciliationFlags)
      .where(
        and(
          eq(reconciliationFlags.kind, "unknown_settlement_ref"),
          eq(reconciliationFlags.ref, "ch_concurrent_unknown"),
        ),
      );
    expect(flagRows).toHaveLength(1);

    expect(await getBalance(db, "bank:NGN")).toBe(40000n);
  });
});

describe("reconcile", () => {
  it("runs every provider given and skips ones with no instance", async () => {
    const provider = new FakeProvider();
    const summaries = await reconcile(db, { fake: provider }, { from: new Date(0), to: NOW });

    expect(Object.keys(summaries)).toEqual(["fake"]);
  });
});
