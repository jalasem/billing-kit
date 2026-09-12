import type { DbOrTx } from "@/db/client";
import { accounts, type Account } from "@/db/schema";

/**
 * Every provider billing-kit ships an adapter for. The chart of accounts
 * gives each one its own clearing and fee accounts so a provider's money
 * never mixes with another's before it settles to the bank.
 */
const PROVIDERS = ["stripe", "paystack", "fake"] as const;

interface AccountSpec {
  code: string;
  name: string;
  type: Account["type"];
}

function specsFor(currency: string): AccountSpec[] {
  const cur = currency.toUpperCase();
  const perProvider = PROVIDERS.flatMap((provider) => [
    { code: `cash:${provider}:${cur}`, name: `${provider} clearing (${cur})`, type: "asset" as const },
    { code: `fees:${provider}:${cur}`, name: `${provider} fees (${cur})`, type: "expense" as const },
    // Money received that couldn't be matched to what it was meant to pay
    // (an invoice-linked payment whose amount/currency didn't match the
    // invoice — see `markInvoicePaid`'s mismatch path). A liability: it is
    // money held pending resolution, not revenue we've earned yet.
    { code: `unapplied:${provider}:${cur}`, name: `${provider} unapplied receipts (${cur})`, type: "liability" as const },
  ]);

  return [
    ...perProvider,
    { code: `bank:${cur}`, name: `Bank (${cur})`, type: "asset" },
    { code: `revenue:${cur}`, name: `Revenue (${cur})`, type: "revenue" },
    // Contra-revenue: modelled as an expense-type account so refunds reduce
    // net income without ever mutating (or crediting past zero) `revenue`.
    { code: `refunds:${cur}`, name: `Refunds (${cur})`, type: "expense" },
    { code: `receivable:${cur}`, name: `Receivable (${cur})`, type: "asset" },
  ];
}

/**
 * Creates the chart of accounts for a currency if it does not already
 * exist. Safe to call repeatedly, including concurrently (e.g. two webhook
 * deliveries or a reconcile run racing a webhook, both needing the same
 * currency's accounts for the first time): each account is inserted with
 * `ON CONFLICT DO NOTHING` rather than a check-then-insert, so a race
 * between two callers can't throw a duplicate-key error — the loser's
 * insert is just a no-op, and the account it wanted already exists either
 * way.
 */
export async function ensureChartOfAccounts(db: DbOrTx, currency: string): Promise<void> {
  const cur = currency.toUpperCase();
  await db
    .insert(accounts)
    .values(specsFor(cur).map((spec) => ({ code: spec.code, name: spec.name, type: spec.type, currency: cur })))
    .onConflictDoNothing({ target: accounts.code });
}

/** Account code helpers, kept next to the chart so callers can't typo a provider or currency in. */
export const chartOfAccounts = {
  cash: (provider: string, currency: string) => `cash:${provider}:${currency.toUpperCase()}`,
  fees: (provider: string, currency: string) => `fees:${provider}:${currency.toUpperCase()}`,
  bank: (currency: string) => `bank:${currency.toUpperCase()}`,
  revenue: (currency: string) => `revenue:${currency.toUpperCase()}`,
  refunds: (currency: string) => `refunds:${currency.toUpperCase()}`,
  receivable: (currency: string) => `receivable:${currency.toUpperCase()}`,
  unapplied: (provider: string, currency: string) => `unapplied:${provider}:${currency.toUpperCase()}`,
};
