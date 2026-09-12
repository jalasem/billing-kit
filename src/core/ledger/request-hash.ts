import { createHash } from "node:crypto";
import type { PostingInput } from "./types";

/**
 * A canonical hash of the parts of a postEntry request that must not change
 * across a replay of the same idempotencyKey: the description and the
 * postings, sorted by account code and currency with amounts as strings (so
 * the hash is stable regardless of bigint/JSON quirks or input ordering).
 */
export function computeRequestHash(description: string, postingsInput: PostingInput[]): string {
  const canonicalPostings = [...postingsInput]
    .map((posting) => ({
      accountCode: posting.accountCode,
      currency: posting.currency.toUpperCase(),
      amount: posting.amount.toString(),
    }))
    .sort((a, b) => `${a.accountCode}:${a.currency}`.localeCompare(`${b.accountCode}:${b.currency}`));

  const canonical = JSON.stringify({ description, postings: canonicalPostings });
  return createHash("sha256").update(canonical).digest("hex");
}
