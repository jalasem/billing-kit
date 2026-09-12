import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DateTime, InvoiceStatusBadge, Money, SubscriptionStatusBadge, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { customers, invoices, plans, subscriptions } from "@/db/schema";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  if (!customer) {
    notFound();
  }

  const [subscriptionRows, invoiceRows] = await Promise.all([
    db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.customerId, id))
      .orderBy(desc(subscriptions.createdAt)),
    db.select().from(invoices).where(eq(invoices.customerId, id)).orderBy(desc(invoices.createdAt)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{customer.email}</h1>
        <p className="text-sm text-slate-600">Customer since <DateTime date={customer.createdAt} /></p>
      </div>

      <Card className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-slate-500">Customer credits</p>
          <p className="text-lg font-medium text-slate-900">
            <Money amount={customer.customerCredits} currency="USD" />
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Default authorization</p>
          <p className="text-lg font-medium text-slate-900">{customer.defaultAuthorization ?? "None on file"}</p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Provider references</p>
          <p className="text-sm text-slate-900">
            {Object.entries(customer.providerRefs).length === 0
              ? "None"
              : Object.entries(customer.providerRefs)
                  .map(([provider, ref]) => `${provider}: ${ref}`)
                  .join(", ")}
          </p>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Subscriptions</h2>
        <Table caption={`Subscriptions for ${customer.email}`}>
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th>Period end</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {subscriptionRows.map((row) => (
              <tr key={row.subscription.id}>
                <Td>{row.plan.name}</Td>
                <Td>
                  <SubscriptionStatusBadge status={row.subscription.status} />
                </Td>
                <Td>
                  <DateTime date={row.subscription.currentPeriodEnd} />
                </Td>
                <Td>
                  <a href={`/admin/subscriptions/${row.subscription.id}`} className="font-medium text-slate-900 underline">
                    View
                  </a>
                </Td>
              </tr>
            ))}
            {subscriptionRows.length === 0 && (
              <tr>
                <Td colSpan={4}>No subscriptions.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
        <Table caption={`Invoices for ${customer.email}`}>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Total</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {invoiceRows.map((invoice) => (
              <tr key={invoice.id}>
                <Td>{invoice.number}</Td>
                <Td>
                  <Money amount={invoice.total} currency={invoice.currency} />
                </Td>
                <Td>
                  <InvoiceStatusBadge status={invoice.status} />
                </Td>
                <Td>
                  <a href={`/admin/invoices/${invoice.id}`} className="font-medium text-slate-900 underline">
                    View
                  </a>
                </Td>
              </tr>
            ))}
            {invoiceRows.length === 0 && (
              <tr>
                <Td colSpan={4}>No invoices.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
