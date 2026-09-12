import type { DbOrTx } from "@/db/client";
import type { Account } from "@/db/schema";
import { createAccount, getAccountByCode } from "./accounts";

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
 * exist. Safe to call repeatedly (e.g. once per webhook or job run): an
 * existing account is left untouched.
 */
export async function ensureChartOfAccounts(db: DbOrTx, currency: string): Promise<void> {
  for (const spec of specsFor(currency)) {
    const existing = await getAccountByCode(db, spec.code);
    if (!existing) {
      await createAccount(db, { code: spec.code, name: spec.name, type: spec.type, currency });
    }
  }
}

/** Account code helpers, kept next to the chart so callers can't typo a provider or currency in. */
export const chartOfAccounts = {
  cash: (provider: string, currency: string) => `cash:${provider}:${currency.toUpperCase()}`,
  fees: (provider: string, currency: string) => `fees:${provider}:${currency.toUpperCase()}`,
  bank: (currency: string) => `bank:${currency.toUpperCase()}`,
  revenue: (currency: string) => `revenue:${currency.toUpperCase()}`,
  refunds: (currency: string) => `refunds:${currency.toUpperCase()}`,
  receivable: (currency: string) => `receivable:${currency.toUpperCase()}`,
};
