import { desc } from "drizzle-orm";
import { Badge, Button, DateTime, Table, Td, Th } from "@/components/ui";
import { db } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { replayWebhookAction } from "../actions";

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ replayed?: string }> }) {
  const { replayed } = await searchParams;
  const rows = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Webhooks</h1>

      {replayed && (
        <p role="status" className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-900">
          Replayed event {replayed}.
        </p>
      )}

      <Table caption="Webhook event log">
        <thead>
          <tr>
            <Th>Provider</Th>
            <Th>Type</Th>
            <Th>Received</Th>
            <Th>Processed</Th>
            <Th>Error</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>{row.provider}</Td>
              <Td>{row.type}</Td>
              <Td>
                <DateTime date={row.receivedAt} />
              </Td>
              <Td>
                {row.processedAt ? (
                  <DateTime date={row.processedAt} />
                ) : (
                  <Badge tone="warning">Unprocessed</Badge>
                )}
              </Td>
              <Td>{row.error ? <Badge tone="danger">{row.error}</Badge> : "—"}</Td>
              <Td>
                <form action={replayWebhookAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="secondary">
                    Replay
                  </Button>
                </form>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={6}>No webhook events yet.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
