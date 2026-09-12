import type { Account } from "@/db/schema";

/**
 * Ledger postings are debit-positive / credit-negative (see the `postings`
 * schema comment), so a raw signed balance already reads naturally for a
 * debit-normal account (`asset`, `expense`) but backwards for a
 * credit-normal one (`liability`, `equity`, `revenue`) — a healthy revenue
 * account nets *negative* under that convention. This flips the sign for
 * credit-normal types so the number shown matches how the account is
 * actually read ("$500 of revenue", not "-$500"); the raw signed value is
 * still available (e.g. in a `title` tooltip) for anyone checking the
 * ledger's own bookkeeping convention.
 */
export function naturalBalance(account: Pick<Account, "type">, balance: bigint): bigint {
  const creditNormal = account.type === "liability" || account.type === "equity" || account.type === "revenue";
  return creditNormal ? -balance : balance;
}
