import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DateTime, InvoiceStatusBadge, Money, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { customers, entries, invoiceLines, invoices, payments } from "@/db/schema";

export default async function AdminInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(eq(invoices.id, id));
  if (!row) {
    notFound();
  }
  const { invoice, customer } = row;

  const [lines, linkedPayments, ledgerEntries] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)),
    invoice.providerRef
      ? db.select().from(payments).where(and(eq(payments.provider, invoice.provider), eq(payments.providerRef, invoice.providerRef)))
      : Promise.resolve([]),
    db
      .select()
      .from(entries)
      .where(
        inArray(entries.idempotencyKey, [`invoice:${invoice.id}:issued`, `invoice:${invoice.id}:paid`, `invoice:${invoice.id}:void`]),
      ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Invoice {invoice.number}</h1>
          <p className="text-sm text-slate-600">
            <a href={`/admin/customers/${customer.id}`} className="underline">
              {customer.email}
            </a>
          </p>
        </div>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <Card>
        <Table caption={`Line items for invoice ${invoice.number}`}>
          <thead>
            <tr>
              <Th>Kind</Th>
              <Th>Description</Th>
              <Th>Quantity</Th>
              <Th>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <Td>{line.kind}</Td>
                <Td>{line.description}</Td>
                <Td>{line.quantity}</Td>
                <Td>
                  <Money amount={line.amount} currency={invoice.currency} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Linked payments</h2>
        <Table caption="Payments linked to this invoice">
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Reference</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Occurred</Th>
            </tr>
          </thead>
          <tbody>
            {linkedPayments.map((payment) => (
              <tr key={payment.id}>
                <Td>{payment.provider}</Td>
                <Td>{payment.providerRef}</Td>
                <Td>
                  <Money amount={payment.amount} currency={payment.currency} />
                </Td>
                <Td>{payment.status}</Td>
                <Td>
                  <DateTime date={payment.occurredAt} />
                </Td>
              </tr>
            ))}
            {linkedPayments.length === 0 && (
              <tr>
                <Td colSpan={5}>No payments linked yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Ledger entries</h2>
        <Table caption="Ledger entries for this invoice (issued, paid, void)">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th>Occurred</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {ledgerEntries.map((entry) => (
              <tr key={entry.id}>
                <Td>{entry.description}</Td>
                <Td>
                  <DateTime date={entry.occurredAt} />
                </Td>
                <Td>
                  <a href={`/admin/ledger/entries/${entry.id}`} className="font-medium text-slate-900 underline">
                    View postings
                  </a>
                </Td>
              </tr>
            ))}
            {ledgerEntries.length === 0 && (
              <tr>
                <Td colSpan={3}>No ledger entries yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
