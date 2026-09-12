import type { Entry, Posting } from "@/db/schema";

export interface PostingInput {
  accountCode: string;
  amount: bigint;
  currency: string;
}

export interface PostEntryInput {
  occurredAt: Date;
  description: string;
  reference?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  postings: PostingInput[];
}

export interface PostEntryResult {
  entry: Entry;
  postings: Posting[];
}
