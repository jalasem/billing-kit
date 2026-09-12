import { desc, ilike } from "drizzle-orm";
import { Button, Card, DateTime, Field, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { customers } from "@/db/schema";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = await db
    .select()
    .from(customers)
    .where(q ? ilike(customers.email, `%${q}%`) : undefined)
    .orderBy(desc(customers.createdAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Search by email" name="q" defaultValue={q ?? ""} placeholder="jane@example.com" />
          <Button type="submit">Search</Button>
        </form>
      </Card>

      <Table caption="Customers">
        <thead>
          <tr>
            <Th>Email</Th>
            <Th>Name</Th>
            <Th>Joined</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((customer) => (
            <tr key={customer.id}>
              <Td>{customer.email}</Td>
              <Td>{customer.name ?? "—"}</Td>
              <Td>
                <DateTime date={customer.createdAt} />
              </Td>
              <Td>
                <a
                  href={`/admin/customers/${customer.id}`}
                  className="font-medium text-slate-900 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  View
                </a>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={4}>No customers found.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
