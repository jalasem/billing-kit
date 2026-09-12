export type NotificationKind = "payment_failed" | "retry_scheduled" | "subscription_cancelled" | "payment_recovered";

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
