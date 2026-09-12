import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accountBalances, postings } from "@/db/schema";
import { requireAccountByCode } from "./accounts";

/** The cached, transactionally-maintained balance. */
export async function getBalance(db: DbOrTx, accountCode: string): Promise<bigint> {
  const account = await requireAccountByCode(db, accountCode);

  const [row] = await db
    .select({ balance: accountBalances.balance })
    .from(accountBalances)
    .where(eq(accountBalances.accountId, account.id));

  return row?.balance ?? 0n;
}

/** The true balance, recomputed from postings. Used to verify the cache. */
export async function recomputeBalance(db: DbOrTx, accountCode: string): Promise<bigint> {
  const account = await requireAccountByCode(db, accountCode);

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${postings.amount}), 0)` })
    .from(postings)
    .where(eq(postings.accountId, account.id));

  return BigInt(row?.total ?? "0");
}
