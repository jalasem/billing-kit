import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { idempotencyKeys } from "@/db/schema";

/**
 * Runs `fn` at most once for a given (scope, key) pair. The first call
 * executes `fn` inside a transaction and stores its JSON-serializable result;
 * every later call with the same key returns that stored result without
 * running `fn` again.
 *
 * A transaction-scoped advisory lock, keyed by a hash of `scope:key`, makes
 * concurrent callers with the same key queue up rather than race: the second
 * caller blocks until the first commits, then finds the stored response and
 * returns it.
 */
export async function withIdempotency<T>(
  db: DbOrTx,
  scope: string,
  key: string,
  fn: (tx: DbOrTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`);

    const [existing] = await tx
      .select({ response: idempotencyKeys.response })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));

    if (existing) {
      return existing.response as T;
    }

    const response = await fn(tx);

    await tx.insert(idempotencyKeys).values({ scope, key, response: response as object });

    return response;
  });
}
