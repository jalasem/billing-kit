import { desc, eq } from "drizzle-orm";
import { Card, InvoiceStatusBadge, Money, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { customers, invoices, type Invoice } from "@/db/schema";

const STATUSES: Array<Invoice["status"]> = ["draft", "open", "paid", "void", "uncollectible"];

export default async function AdminInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filterStatus = STATUSES.find((candidate) => candidate === status);

  const rows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(filterStatus ? eq(invoices.status, filterStatus) : undefined)
    .orderBy(desc(invoices.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-sm font-medium text-slate-900">
              Filter by status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={filterStatus ?? ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <option value="">All</option>
              {STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Apply
          </button>
        </form>
      </Card>

      <Table caption="Invoices">
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Customer</Th>
            <Th>Total</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.invoice.id}>
              <Td>{row.invoice.number}</Td>
              <Td>{row.customer.email}</Td>
              <Td>
                <Money amount={row.invoice.total} currency={row.invoice.currency} />
              </Td>
              <Td>
                <InvoiceStatusBadge status={row.invoice.status} />
              </Td>
              <Td>
                <a href={`/admin/invoices/${row.invoice.id}`} className="font-medium text-slate-900 underline">
                  View
                </a>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={5}>No invoices found.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
