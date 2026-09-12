export type NotificationKind =
  | "payment_failed"
  | "retry_scheduled"
  | "subscription_cancelled"
  | "payment_recovered"
  | "magic_link";

/**
 * Kinds whose payload carries a secret (a magic-link URL embeds the raw
 * token) — `notify()` persists a redacted `notifications.payload` for
 * these, and passes the real payload only to `Notifier.send()`.
 */
export const SENSITIVE_NOTIFICATION_KINDS: ReadonlySet<NotificationKind> = new Set(["magic_link"]);

export interface NotificationTemplate {
  subject: string;
  text: string;
  html: string;
}

export interface NotifierSendInput {
  kind: NotificationKind;
  recipient: string;
  payload: Record<string, unknown>;
}

export interface Notifier {
  /** Recorded on the `notifications` row so an operator can see which channel a send went through. */
  readonly channel: string;
  send(notification: NotifierSendInput): Promise<void>;
}
