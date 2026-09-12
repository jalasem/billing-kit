import { renderTemplate } from "./templates";
import type { Notifier, NotifierSendInput } from "./types";

export interface ResendNotifierOptions {
  apiKey: string;
  from: string;
  /** Injected in tests to avoid a live network call. */
  fetchImpl?: typeof fetch;
}

/**
 * Sends through Resend's API directly via `fetch` — no SDK. The exact
 * request shape (`POST https://api.resend.com/emails` with `from`, `to`,
 * `subject`, `text`, `html`) is the minimal, documented one; see the M3
 * report for the note on why nothing more provider-specific is assumed.
 */
export class ResendNotifier implements Notifier {
  readonly channel = "resend";

  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendNotifierOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(notification: NotifierSendInput): Promise<void> {
    const template = renderTemplate(notification.kind, notification.payload);

    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: notification.recipient,
        subject: template.subject,
        text: template.text,
        html: template.html,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API responded ${response.status}`);
    }
  }
}
