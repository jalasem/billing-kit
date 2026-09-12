import { desc, eq } from "drizzle-orm";
import { DateTime, InvoiceStatusBadge, Money, Table, Td, Th } from "@/components/ui";
import { requireCustomerSession } from "@/core/auth";
import { db } from "@/db/client";
import { invoices } from "@/db/schema";

export default async function InvoicesPage() {
  const session = await requireCustomerSession();
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.customerId, session.customerId))
    .orderBy(desc(invoices.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">You have no invoices yet.</p>
      ) : (
        <Table caption="Your invoices">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>Total</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => (
              <tr key={invoice.id}>
                <Td>{invoice.number}</Td>
                <Td>
                  <DateTime date={invoice.createdAt} />
                </Td>
                <Td>
                  <Money amount={invoice.total} currency={invoice.currency} />
                </Td>
                <Td>
                  <InvoiceStatusBadge status={invoice.status} />
                </Td>
                <Td>
                  <a
                    href={`/portal/invoices/${invoice.id}`}
                    className="font-medium text-slate-900 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    View
                  </a>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
