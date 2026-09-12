import { eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accountBalances, accounts, auditLog, entries, postings, type Posting } from "@/db/schema";
import type { PostEntryInput, PostEntryResult, PostingInput } from "./types";

export async function postEntry(db: DbOrTx, input: PostEntryInput): Promise<PostEntryResult> {
  assertBalanced(input.postings);

  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await replayIfAlreadyPosted(tx, input.idempotencyKey);
      if (replay) {
        return replay;
      }
    }

    const accountsByCode = await loadAndValidateAccounts(tx, input.postings);

    const [entry] = await tx
      .insert(entries)
      .values({
        occurredAt: input.occurredAt,
        description: input.description,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
      })
      .returning();

    const insertedPostings: Posting[] = [];
    for (const posting of input.postings) {
      const account = accountsByCode.get(posting.accountCode)!;
      const currency = posting.currency.toUpperCase();

      const [row] = await tx
        .insert(postings)
        .values({
          entryId: entry.id,
          accountId: account.id,
          amount: posting.amount,
          currency,
        })
        .returning();
      insertedPostings.push(row);

      await tx
        .insert(accountBalances)
        .values({ accountId: account.id, balance: posting.amount })
        .onConflictDoUpdate({
          target: accountBalances.accountId,
          set: {
            balance: sql`${accountBalances.balance} + ${posting.amount}`,
            updatedAt: sql`now()`,
          },
        });
    }

    await tx.insert(auditLog).values({
      actor: "system",
      action: "ledger.entry.posted",
      subject: entry.id,
      details: { description: entry.description, postingCount: insertedPostings.length },
    });

    return { entry, postings: insertedPostings };
  });
}

/**
 * Takes an advisory lock scoped to this idempotency key, for the life of the
 * transaction, so two concurrent posts of the same key serialize instead of
 * racing to insert the same entry.
 */
async function replayIfAlreadyPosted(
  tx: DbOrTx,
  idempotencyKey: string,
): Promise<PostEntryResult | undefined> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ledger:entry:${idempotencyKey}`}, 0))`,
  );

  const [existingEntry] = await tx.select().from(entries).where(eq(entries.idempotencyKey, idempotencyKey));
  if (!existingEntry) {
    return undefined;
  }

  const existingPostings = await tx.select().from(postings).where(eq(postings.entryId, existingEntry.id));
  return { entry: existingEntry, postings: existingPostings };
}

async function loadAndValidateAccounts(tx: DbOrTx, postingsInput: PostingInput[]) {
  const codes = [...new Set(postingsInput.map((posting) => posting.accountCode))];
  const accountRows = await tx.select().from(accounts).where(inArray(accounts.code, codes));
  const accountsByCode = new Map(accountRows.map((account) => [account.code, account]));

  for (const posting of postingsInput) {
    const account = accountsByCode.get(posting.accountCode);
    if (!account) {
      throw new Error(`Unknown account code: ${posting.accountCode}`);
    }
    if (account.currency !== posting.currency.toUpperCase()) {
      throw new Error(
        `Posting currency ${posting.currency} does not match account ${posting.accountCode} currency ${account.currency}`,
      );
    }
  }

  return accountsByCode;
}

function assertBalanced(postingsInput: PostingInput[]): void {
  if (postingsInput.length < 2) {
    throw new Error("An entry needs at least two postings");
  }

  const totalsByCurrency = new Map<string, bigint>();
  for (const posting of postingsInput) {
    const currency = posting.currency.toUpperCase();
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0n) + posting.amount);
  }

  for (const [currency, total] of totalsByCurrency) {
    if (total !== 0n) {
      throw new Error(`Postings for currency ${currency} do not sum to zero: ${total}`);
    }
  }
}
