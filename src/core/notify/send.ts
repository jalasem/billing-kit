import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notifications } from "@/db/schema";
import type { NotificationKind, Notifier } from "./types";

/**
 * Records the notification first (so it exists even if sending throws),
 * then sends it. A failed send leaves `sentAt` null and `error` set,
 * rather than throwing out of the caller's business transaction — dunning
 * must not fail to record a payment outcome just because the email
 * provider is down.
 */
export async function notify(
  db: DbOrTx,
  notifier: Notifier,
  kind: NotificationKind,
  recipient: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const [row] = await db
    .insert(notifications)
    .values({ kind, recipient, payload, channel: notifier.channel })
    .returning();

  try {
    await notifier.send({ kind, recipient, payload });
    await db.update(notifications).set({ sentAt: new Date() }).where(eq(notifications.id, row.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(notifications).set({ error: message }).where(eq(notifications.id, row.id));
  }
}
