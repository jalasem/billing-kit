import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

/** Truncates every ledger table. TRUNCATE bypasses the append-only DELETE triggers. */
export async function resetLedgerTables(db: DbOrTx): Promise<void> {
  await db.execute(
    sql`truncate table audit_log, idempotency_keys, account_balances, postings, entries, accounts cascade`,
  );
}

/** Truncates the ledger tables plus every M2 billing table (providers, webhooks, reconciliation). */
export async function resetBillingTables(db: DbOrTx): Promise<void> {
  await db.execute(
    sql`truncate table
      audit_log, idempotency_keys, account_balances, postings, entries, accounts,
      reconciliation_flags, webhook_events, settlements, refunds, payments, customers
      cascade`,
  );
}

/** Truncates the ledger, M2, and M3 tables (subscriptions, invoices, dunning, notifications). */
export async function resetM3Tables(db: DbOrTx): Promise<void> {
  await db.execute(
    sql`truncate table
      audit_log, idempotency_keys, account_balances, postings, entries, accounts,
      reconciliation_flags, webhook_events, settlements, refunds, payments, customers,
      dunning_attempts, notifications, invoice_lines, invoices, invoice_sequences,
      subscriptions, plans, products
      cascade`,
  );
}
