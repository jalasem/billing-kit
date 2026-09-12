import { asc, eq } from "drizzle-orm";
import { Money, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { accountBalances, accounts } from "@/db/schema";

export default async function LedgerPage() {
  const rows = await db
    .select({ account: accounts, balance: accountBalances.balance })
    .from(accounts)
    .leftJoin(accountBalances, eq(accounts.id, accountBalances.accountId))
    .orderBy(asc(accounts.code));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Ledger</h1>
      <Table caption="Chart of accounts and balances">
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Balance</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.account.id}>
              <Td>
                <code>{row.account.code}</code>
              </Td>
              <Td>{row.account.name}</Td>
              <Td>{row.account.type}</Td>
              <Td>
                <Money amount={row.balance ?? 0n} currency={row.account.currency} />
              </Td>
              <Td>
                <a href={`/admin/ledger/accounts/${encodeURIComponent(row.account.code)}`} className="font-medium text-slate-900 underline">
                  View postings
                </a>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={5}>No accounts yet.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
