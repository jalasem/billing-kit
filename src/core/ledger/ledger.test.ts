import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { accounts, entries, postings, type Account } from "@/db/schema";
import { resetLedgerTables } from "@/test/reset-db";
import { createAccount, getBalance, postEntry, recomputeBalance } from "./index";

let cash: Account;
let revenue: Account;

/**
 * drizzle-orm's postgres-js driver wraps every failed query in a generic
 * `DrizzleQueryError` and puts the real Postgres error on `.cause`, so
 * assertions on the raised message need to look there.
 */
async function expectRejectionMessage(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const message = cause instanceof Error ? cause.message : String(cause);
    return pattern.test(message);
  });
}

beforeEach(async () => {
  await resetLedgerTables(db);
  cash = await createAccount(db, { code: "cash", name: "Cash", type: "asset", currency: "NGN" });
  revenue = await createAccount(db, { code: "revenue", name: "Revenue", type: "revenue", currency: "NGN" });
});

describe("invariant 1: entries must balance to zero per currency", () => {
  it("is rejected by the database even when inserted with raw SQL bypassing app validation", async () => {
    await expect(
      db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(entries)
          .values({ occurredAt: new Date(), description: "raw unbalanced entry" })
          .returning();

        await tx.insert(postings).values({ entryId: entry.id, accountId: cash.id, amount: 1000n, currency: "NGN" });
        await tx.insert(postings).values({
          entryId: entry.id,
          accountId: revenue.id,
          amount: -900n,
          currency: "NGN",
        });
      }),
    ).rejects.toThrow(/does not balance/i);
  });

  it("is rejected via the app's own postEntry validation before touching the database", async () => {
    await expect(
      postEntry(db, {
        occurredAt: new Date(),
        description: "unbalanced via app",
        postings: [
          { accountCode: "cash", amount: 1000n, currency: "NGN" },
          { accountCode: "revenue", amount: -900n, currency: "NGN" },
        ],
      }),
    ).rejects.toThrow(/do not sum to zero/i);
  });
});

describe("a posting's currency must match its account's currency", () => {
  it("is rejected by the database", async () => {
    await expectRejectionMessage(
      db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(entries)
          .values({ occurredAt: new Date(), description: "wrong currency" })
          .returning();

        await tx.insert(postings).values({ entryId: entry.id, accountId: cash.id, amount: 1000n, currency: "USD" });
      }),
      /does not match account/i,
    );
  });
});

describe("invariant 2: entries and postings are append-only", () => {
  it("rejects UPDATE and DELETE on entries and postings", async () => {
    const { entry, postings: created } = await postEntry(db, {
      occurredAt: new Date(),
      description: "immutability test",
      postings: [
        { accountCode: "cash", amount: 500n, currency: "NGN" },
        { accountCode: "revenue", amount: -500n, currency: "NGN" },
      ],
    });

    await expectRejectionMessage(
      db.update(entries).set({ description: "edited" }).where(eq(entries.id, entry.id)),
      /append-only/i,
    );

    await expectRejectionMessage(db.delete(entries).where(eq(entries.id, entry.id)), /append-only/i);

    await expectRejectionMessage(
      db.update(postings).set({ amount: 1n }).where(eq(postings.id, created[0].id)),
      /append-only/i,
    );

    await expectRejectionMessage(db.delete(postings).where(eq(postings.id, created[0].id)), /append-only/i);
  });
});

describe("invariant 3: idempotent posting", () => {
  it("posting the same idempotencyKey twice yields one entry and identical balances", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      occurredAt: new Date(),
      description: "Paystack charge",
      idempotencyKey,
      postings: [
        { accountCode: "cash", amount: 1000n, currency: "NGN" },
        { accountCode: "revenue", amount: -1000n, currency: "NGN" },
      ],
    };

    const first = await postEntry(db, input);
    const second = await postEntry(db, input);

    expect(second.entry.id).toBe(first.entry.id);
    expect(second.postings.map((p) => p.id).sort()).toEqual(first.postings.map((p) => p.id).sort());

    const rows = await db.select().from(entries).where(eq(entries.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);

    expect(await getBalance(db, "cash")).toBe(1000n);
    expect(await getBalance(db, "revenue")).toBe(-1000n);
  });

  it("runs postEntry exactly once for two concurrent calls with the same idempotencyKey", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      occurredAt: new Date(),
      description: "concurrent charge",
      idempotencyKey,
      postings: [
        { accountCode: "cash", amount: 250n, currency: "NGN" },
        { accountCode: "revenue", amount: -250n, currency: "NGN" },
      ],
    };

    const [a, b] = await Promise.all([postEntry(db, input), postEntry(db, input)]);

    expect(a.entry.id).toBe(b.entry.id);

    const rows = await db.select().from(entries).where(eq(entries.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
    expect(await getBalance(db, "cash")).toBe(250n);
  });
});

describe("invariant 5: cached balances match the sum of postings", () => {
  it("matches recomputeBalance for every account after 200 random balanced entries", async () => {
    const codes = ["a1", "a2", "a3", "a4", "a5"];
    for (const code of codes) {
      await createAccount(db, { code, name: code, type: "asset", currency: "NGN" });
    }

    for (let i = 0; i < 200; i += 1) {
      await postEntry(db, {
        occurredAt: new Date(),
        description: `random entry ${i}`,
        postings: randomBalancedPostings(codes),
      });
    }

    for (const code of codes) {
      const [cached, recomputed] = await Promise.all([getBalance(db, code), recomputeBalance(db, code)]);
      expect(cached).toBe(recomputed);
    }
  }, 60_000);
});

/** Picks 2-5 of the given account codes and assigns amounts that sum to zero. */
function randomBalancedPostings(codes: string[]): Array<{ accountCode: string; amount: bigint; currency: string }> {
  const count = 2 + Math.floor(Math.random() * (codes.length - 1));
  const shuffled = [...codes].sort(() => Math.random() - 0.5).slice(0, count);

  const amounts = shuffled.slice(0, -1).map(() => BigInt(1 + Math.floor(Math.random() * 10_000)));
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  amounts.push(-total);

  return shuffled.map((accountCode, index) => ({
    accountCode,
    amount: amounts[index],
    currency: "NGN",
  }));
}

describe("createAccount", () => {
  it("creates an account and enforces a unique code", async () => {
    const account = await db.select().from(accounts).where(eq(accounts.code, "cash"));
    expect(account).toHaveLength(1);

    await expect(
      createAccount(db, { code: "cash", name: "Duplicate", type: "asset", currency: "NGN" }),
    ).rejects.toThrow();
  });
});
