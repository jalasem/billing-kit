import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DateTime, Money, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { accounts, auditLog, entries, postings } from "@/db/schema";

export default async function LedgerEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [entry] = await db.select().from(entries).where(eq(entries.id, id));
  if (!entry) {
    notFound();
  }

  const [postingRows, auditRows] = await Promise.all([
    db
      .select({ posting: postings, account: accounts })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(eq(postings.entryId, entry.id)),
    db.select().from(auditLog).where(eq(auditLog.subject, entry.id)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{entry.description}</h1>
        <p className="text-sm text-slate-600">
          Occurred <DateTime date={entry.occurredAt} /> · Recorded <DateTime date={entry.createdAt} />
        </p>
      </div>

      <Card className="flex flex-col gap-2">
        <p className="text-sm text-slate-500">Metadata</p>
        <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-900">{JSON.stringify(entry.metadata, null, 2)}</pre>
        {entry.idempotencyKey && (
          <p className="text-sm text-slate-600">
            Idempotency key: <code>{entry.idempotencyKey}</code>
          </p>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Postings</h2>
        <Table caption={`Postings for entry ${entry.id}`}>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {postingRows.map((row) => (
              <tr key={row.posting.id}>
                <Td>
                  <a href={`/admin/ledger/accounts/${encodeURIComponent(row.account.code)}`} className="underline">
                    {row.account.code}
                  </a>
                </Td>
                <Td>
                  <Money amount={row.posting.amount} currency={row.posting.currency} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Audit row</h2>
        <Table caption="Audit log rows for this entry">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {auditRows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <DateTime date={row.createdAt} />
                </Td>
                <Td>{row.actor}</Td>
                <Td>{row.action}</Td>
              </tr>
            ))}
            {auditRows.length === 0 && (
              <tr>
                <Td colSpan={3}>No audit row recorded.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
