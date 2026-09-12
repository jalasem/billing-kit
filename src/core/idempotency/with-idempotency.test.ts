import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { withIdempotency } from "./with-idempotency";

async function resetTable(): Promise<void> {
  await db.execute(sql`truncate table idempotency_keys`);
}

describe("withIdempotency", () => {
  beforeEach(resetTable);

  it("stores the response and returns it on a repeat call without re-running fn", async () => {
    const scope = "test-scope";
    const key = randomUUID();
    let runs = 0;

    const fn = async () => {
      runs += 1;
      return { ok: true, runs };
    };

    const first = await withIdempotency(db, scope, key, fn);
    const second = await withIdempotency(db, scope, key, fn);

    expect(first).toEqual({ ok: true, runs: 1 });
    expect(second).toEqual({ ok: true, runs: 1 });
    expect(runs).toBe(1);
  });

  it("runs fn exactly once for two concurrent calls with the same key", async () => {
    const scope = "concurrent-scope";
    const key = randomUUID();
    let runs = 0;

    const fn = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { runs };
    };

    const [a, b] = await Promise.all([
      withIdempotency(db, scope, key, fn),
      withIdempotency(db, scope, key, fn),
    ]);

    expect(runs).toBe(1);
    expect(a).toEqual(b);
  });

  it("keeps different keys independent", async () => {
    let runs = 0;
    const fn = async () => {
      runs += 1;
      return { runs };
    };

    await withIdempotency(db, "scope-a", randomUUID(), fn);
    await withIdempotency(db, "scope-a", randomUUID(), fn);

    expect(runs).toBe(2);
  });
});
