import { desc, isNull } from "drizzle-orm";
import { Badge, Button, DateTime, Money, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { reconciliationFlags, settlements } from "@/db/schema";
import { resolveReconciliationFlagAction, runReconciliationNowAction } from "../actions";

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ resolved?: string; ran?: string }> }) {
  const { resolved, ran } = await searchParams;

  const [flags, settlementRows] = await Promise.all([
    db.select().from(reconciliationFlags).where(isNull(reconciliationFlags.resolvedAt)).orderBy(desc(reconciliationFlags.createdAt)),
    db.select().from(settlements).orderBy(desc(settlements.settledAt)).limit(50),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Reconciliation</h1>
        <form action={runReconciliationNowAction}>
          <Button type="submit">Run reconciliation now</Button>
        </form>
      </div>

      {ran === "1" && (
        <p role="status" className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900">
          Reconciliation run completed.
        </p>
      )}
      {resolved && (
        <p role="status" className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-900">
          Resolved flag {resolved}.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Unresolved flags</h2>
        <Table caption="Unresolved reconciliation flags">
          <thead>
            <tr>
              <Th>Kind</Th>
              <Th>Provider</Th>
              <Th>Reference</Th>
              <Th>Raised</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id}>
                <Td>
                  <Badge tone="warning">{flag.kind.replace(/_/g, " ")}</Badge>
                </Td>
                <Td>{flag.provider}</Td>
                <Td>{flag.ref}</Td>
                <Td>
                  <DateTime date={flag.createdAt} />
                </Td>
                <Td>
                  <form action={resolveReconciliationFlagAction}>
                    <input type="hidden" name="id" value={flag.id} />
                    <Button type="submit" variant="secondary">
                      Resolve
                    </Button>
                  </form>
                </Td>
              </tr>
            ))}
            {flags.length === 0 && (
              <tr>
                <Td colSpan={5}>No unresolved flags.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Settlements</h2>
        <Table caption="Settlements posted to the ledger">
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Settlement</Th>
              <Th>Amount</Th>
              <Th>Fee</Th>
              <Th>Settled</Th>
            </tr>
          </thead>
          <tbody>
            {settlementRows.map((settlement) => (
              <tr key={settlement.id}>
                <Td>{settlement.provider}</Td>
                <Td>{settlement.settlementId}</Td>
                <Td>
                  <Money amount={settlement.amount} currency={settlement.currency} />
                </Td>
                <Td>
                  <Money amount={settlement.fee} currency={settlement.currency} />
                </Td>
                <Td>
                  <DateTime date={settlement.settledAt} />
                </Td>
              </tr>
            ))}
            {settlementRows.length === 0 && (
              <tr>
                <Td colSpan={5}>No settlements recorded yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
