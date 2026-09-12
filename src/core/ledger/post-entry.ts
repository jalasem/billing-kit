import { eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accountBalances, accounts, auditLog, entries, postings, type Account } from "@/db/schema";
import { IdempotencyConflictError } from "./errors";
import { computeRequestHash } from "./request-hash";
import type { PostEntryInput, PostEntryResult, PostingInput } from "./types";

/** Postgres error codes worth retrying a whole transaction for. */
const RETRYABLE_SQLSTATES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
]);
const MAX_ATTEMPTS = 3;

export async function postEntry(db: DbOrTx, input: PostEntryInput): Promise<PostEntryResult> {
  assertBalanced(input.postings);
  const requestHash = computeRequestHash(input.description, input.postings);

  return withRetryOnTransientConflict(() =>
    db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const replay = await replayIfAlreadyPosted(tx, input.idempotencyKey, requestHash);
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
          requestHash,
          metadata: input.metadata ?? {},
        })
        .returning();

      const insertedPostings = await tx
        .insert(postings)
        .values(
          input.postings.map((posting) => ({
            entryId: entry.id,
            accountId: accountsByCode.get(posting.accountCode)!.id,
            amount: posting.amount,
            currency: posting.currency.toUpperCase(),
          })),
        )
        .returning();

      await applyBalanceDeltas(tx, input.postings, accountsByCode);

      await tx.insert(auditLog).values({
        actor: "system",
        action: "ledger.entry.posted",
        subject: entry.id,
        details: { description: entry.description, postingCount: insertedPostings.length },
      });

      return { entry, postings: insertedPostings };
    }),
  );
}

/**
 * Takes an advisory lock scoped to this idempotency key, for the life of the
 * transaction, so two concurrent posts of the same key serialize instead of
 * racing to insert the same entry. If the key was already used for a
 * different request (different description or postings), the replay is
 * refused rather than silently returning someone else's entry.
 */
async function replayIfAlreadyPosted(
  tx: DbOrTx,
  idempotencyKey: string,
  requestHash: string,
): Promise<PostEntryResult | undefined> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ledger:entry:${idempotencyKey}`}, 0))`,
  );

  const [existingEntry] = await tx.select().from(entries).where(eq(entries.idempotencyKey, idempotencyKey));
  if (!existingEntry) {
    return undefined;
  }

  if (existingEntry.requestHash !== requestHash) {
    throw new IdempotencyConflictError(idempotencyKey);
  }

  const existingPostings = await tx.select().from(postings).where(eq(postings.entryId, existingEntry.id));
  return { entry: existingEntry, postings: existingPostings };
}

async function loadAndValidateAccounts(
  tx: DbOrTx,
  postingsInput: PostingInput[],
): Promise<Map<string, Account>> {
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

/**
 * Upserts one row per account, in ascending account-id order. Two
 * transactions that touch the same accounts always take their row locks in
 * the same order this way, which is what actually prevents a deadlock (the
 * retry in postEntry is a backstop for the rest: concurrent writers outside
 * this function, replication conflicts, etc.).
 */
async function applyBalanceDeltas(
  tx: DbOrTx,
  postingsInput: PostingInput[],
  accountsByCode: Map<string, Account>,
): Promise<void> {
  const deltaByAccountId = new Map<string, bigint>();
  for (const posting of postingsInput) {
    const accountId = accountsByCode.get(posting.accountCode)!.id;
    deltaByAccountId.set(accountId, (deltaByAccountId.get(accountId) ?? 0n) + posting.amount);
  }

  const orderedAccountIds = [...deltaByAccountId.keys()].sort();

  for (const accountId of orderedAccountIds) {
    const delta = deltaByAccountId.get(accountId)!;
    await tx
      .insert(accountBalances)
      .values({ accountId, balance: delta })
      .onConflictDoUpdate({
        target: accountBalances.accountId,
        set: {
          balance: sql`${accountBalances.balance} + ${delta}`,
          updatedAt: sql`now()`,
        },
      });
  }
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

async function withRetryOnTransientConflict<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (isLastAttempt || !isRetryablePgError(error)) {
        throw error;
      }
    }
  }
  // Unreachable: the loop always returns or throws.
  throw new Error("withRetryOnTransientConflict exhausted attempts without an error");
}

function isRetryablePgError(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}

function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return pgErrorCode((error as { cause?: unknown }).cause);
  }
  return undefined;
}
