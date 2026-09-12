import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Button, Card, DateTime, Money, Table, Td, Th } from "@/components/ui";
import { getAccountByCode, getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { entries, postings } from "@/db/schema";
import { verifyAccountBalanceAction } from "@/app/(admin)/admin/actions";

const PAGE_SIZE = 25;

export default async function LedgerAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ page?: string; cached?: string; recomputed?: string }>;
}) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const { page: pageParam, cached, recomputed } = await searchParams;

  const account = await getAccountByCode(db, code);
  if (!account) {
    notFound();
  }

  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const balance = await getBalance(db, code);

  const rows = await db
    .select({ posting: postings, entry: entries })
    .from(postings)
    .innerJoin(entries, eq(postings.entryId, entries.id))
    .where(eq(postings.accountId, account.id))
    .orderBy(desc(postings.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          <code>{account.code}</code>
        </h1>
        <p className="text-sm text-slate-600">{account.name}</p>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Cached balance</p>
          <p className="text-2xl font-semibold text-slate-900">
            <Money amount={balance} currency={account.currency} />
          </p>
        </div>
        <form action={verifyAccountBalanceAction}>
          <input type="hidden" name="code" value={account.code} />
          <Button type="submit" variant="secondary">
            Verify
          </Button>
        </form>
      </Card>

      {cached !== undefined && recomputed !== undefined && (
        <p
          role="status"
          className={`rounded-md px-4 py-3 text-sm ${cached === recomputed ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
        >
          {cached === recomputed
            ? `Verified: cached balance matches the sum of postings (${cached}).`
            : `Mismatch: cached balance ${cached} does not equal the recomputed sum ${recomputed}.`}
        </p>
      )}

      <Table caption={`Postings for ${account.code}, newest first`}>
        <thead>
          <tr>
            <Th>Occurred</Th>
            <Th>Description</Th>
            <Th>Amount</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.posting.id}>
              <Td>
                <DateTime date={row.posting.createdAt} />
              </Td>
              <Td>{row.entry.description}</Td>
              <Td>
                <Money amount={row.posting.amount} currency={row.posting.currency} />
              </Td>
              <Td>
                <a href={`/admin/ledger/entries/${row.entry.id}`} className="font-medium text-slate-900 underline">
                  View entry
                </a>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={4}>No postings on this page.</Td>
            </tr>
          )}
        </tbody>
      </Table>

      <nav aria-label="Pagination" className="flex gap-3 text-sm">
        {page > 1 && (
          <a href={`/admin/ledger/accounts/${encodeURIComponent(code)}?page=${page - 1}`} className="underline">
            Previous
          </a>
        )}
        {rows.length === PAGE_SIZE && (
          <a href={`/admin/ledger/accounts/${encodeURIComponent(code)}?page=${page + 1}`} className="underline">
            Next
          </a>
        )}
      </nav>
    </div>
  );
}
