import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DateTime, InvoiceStatusBadge, Money, Table, Td, Th } from "@/components/ui";
import { requireCustomerSession } from "@/core/auth";
import { db } from "@/db/client";
import { invoiceLines, invoices } from "@/db/schema";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCustomerSession();

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) {
    notFound();
  }
  if (invoice.customerId !== session.customerId) {
    // Look like a 404 rather than leaking that the invoice id exists.
    notFound();
  }

  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Invoice {invoice.number}</h1>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <Card className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Issued</dt>
            <dd className="text-slate-900">
              <DateTime date={invoice.createdAt} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Due</dt>
            <dd className="text-slate-900">
              <DateTime date={invoice.dueAt} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Total</dt>
            <dd className="text-slate-900">
              <Money amount={invoice.total} currency={invoice.currency} />
            </dd>
          </div>
        </dl>

        <Table caption={`Line items for invoice ${invoice.number}`}>
          <thead>
            <tr>
              <Th>Description</Th>
              <Th>Quantity</Th>
              <Th>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
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
    </div>
  );
}
