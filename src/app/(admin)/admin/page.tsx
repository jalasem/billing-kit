import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { Card } from "@/components/ui";
import { db } from "@/db/client";
import { customers, invoices, reconciliationFlags, subscriptions, webhookEvents } from "@/db/schema";

async function scalarCount(query: Promise<Array<{ value: number }>>): Promise<number> {
  const [row] = await query;
  return row?.value ?? 0;
}

export default async function AdminDashboardPage() {
  const [customerCount, activeSubscriptionCount, openInvoiceCount, unresolvedFlagCount, failedWebhookCount] = await Promise.all([
    scalarCount(db.select({ value: count() }).from(customers)),
    scalarCount(db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active"))),
    scalarCount(db.select({ value: count() }).from(invoices).where(eq(invoices.status, "open"))),
    scalarCount(db.select({ value: count() }).from(reconciliationFlags).where(isNull(reconciliationFlags.resolvedAt))),
    scalarCount(db.select({ value: count() }).from(webhookEvents).where(and(isNull(webhookEvents.processedAt), isNotNull(webhookEvents.error)))),
  ]);

  const tiles = [
    { label: "Customers", value: customerCount, href: "/admin/customers" },
    { label: "Active subscriptions", value: activeSubscriptionCount, href: "/admin/subscriptions?status=active" },
    { label: "Open invoices", value: openInvoiceCount, href: "/admin/invoices?status=open" },
    { label: "Unresolved reconciliation flags", value: unresolvedFlagCount, href: "/admin/reconciliation" },
    { label: "Failed webhooks", value: failedWebhookCount, href: "/admin/webhooks" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <a
            key={tile.label}
            href={tile.href}
            className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <Card>
              <p className="text-sm text-slate-600">{tile.label}</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">{tile.value}</p>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
