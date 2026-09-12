import { desc, eq } from "drizzle-orm";
import { Card, DateTime, SubscriptionStatusBadge, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { customers, plans, subscriptions, type Subscription } from "@/db/schema";

const STATUSES: Array<Subscription["status"]> = ["trialing", "active", "past_due", "unpaid", "cancelled", "paused"];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filterStatus = STATUSES.find((candidate) => candidate === status);

  const rows = await db
    .select({ subscription: subscriptions, plan: plans, customer: customers })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(filterStatus ? eq(subscriptions.status, filterStatus) : undefined)
    .orderBy(desc(subscriptions.createdAt))
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Subscriptions</h1>

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
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
            Apply
          </button>
        </form>
      </Card>

      <Table caption="Subscriptions">
        <thead>
          <tr>
            <Th>Customer</Th>
            <Th>Plan</Th>
            <Th>Status</Th>
            <Th>Period end</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.subscription.id}>
              <Td>{row.customer.email}</Td>
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
          {rows.length === 0 && (
            <tr>
              <Td colSpan={5}>No subscriptions found.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
