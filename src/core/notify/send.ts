import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notifications } from "@/db/schema";
import { SENSITIVE_NOTIFICATION_KINDS, type NotificationKind, type Notifier } from "./types";

/**
 * Records the notification first (so it exists even if sending throws),
 * then sends it. A failed send leaves `sentAt` null and `error` set,
 * rather than throwing out of the caller's business transaction — dunning
 * must not fail to record a payment outcome just because the email
 * provider is down.
 *
 * For a `SENSITIVE_NOTIFICATION_KINDS` kind (e.g. `magic_link`, whose
 * payload embeds a raw, unhashed token in a URL), the row persisted to
 * `notifications.payload` is redacted to `{ kind, recipient, redacted:
 * true }` — the real payload is passed only to `notifier.send()`, so the
 * secret exists in memory for this one call and never touches the
 * database.
 */
export async function notify(
  db: DbOrTx,
  notifier: Notifier,
  kind: NotificationKind,
  recipient: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const storedPayload = SENSITIVE_NOTIFICATION_KINDS.has(kind) ? { kind, recipient, redacted: true } : payload;

  const [row] = await db
    .insert(notifications)
    .values({ kind, recipient, payload: storedPayload, channel: notifier.channel })
    .returning();

  try {
    await notifier.send({ kind, recipient, payload });
    await db.update(notifications).set({ sentAt: new Date() }).where(eq(notifications.id, row.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(notifications).set({ error: message }).where(eq(notifications.id, row.id));
  }
}
