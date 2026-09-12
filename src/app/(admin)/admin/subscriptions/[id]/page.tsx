import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, DateTime, Money, SubscriptionStatusBadge, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { auditLog, customers, plans, subscriptions } from "@/db/schema";

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({ subscription: subscriptions, plan: plans, customer: customers })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(eq(subscriptions.id, id));

  if (!row) {
    notFound();
  }

  const history = await db.select().from(auditLog).where(eq(auditLog.subject, id)).orderBy(desc(auditLog.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{row.plan.name}</h1>
          <p className="text-sm text-slate-600">
            <a href={`/admin/customers/${row.customer.id}`} className="underline">
              {row.customer.email}
            </a>
          </p>
        </div>
        <SubscriptionStatusBadge status={row.subscription.status} />
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Amount</dt>
            <dd className="text-slate-900">
              <Money amount={row.plan.amount} currency={row.plan.currency} /> / {row.plan.interval}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Current period</dt>
            <dd className="text-slate-900">
              <DateTime date={row.subscription.currentPeriodStart} /> – <DateTime date={row.subscription.currentPeriodEnd} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Provider</dt>
            <dd className="text-slate-900">
              {row.subscription.provider} {row.subscription.providerSubscriptionId ?? ""}
            </dd>
          </div>
        </dl>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">State history</h2>
        <Table caption="Subscription state history">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <Td>
                  <DateTime date={entry.createdAt} />
                </Td>
                <Td>{entry.actor}</Td>
                <Td>{entry.action}</Td>
                <Td>
                  <code className="text-xs">{JSON.stringify(entry.details)}</code>
                </Td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <Td colSpan={4}>No recorded state changes yet.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
