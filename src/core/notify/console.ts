import { renderTemplate } from "./templates";
import type { Notifier, NotifierSendInput } from "./types";

/** Default notifier: logs the rendered template instead of sending anything. */
export class ConsoleNotifier implements Notifier {
  readonly channel = "console";

  async send(notification: NotifierSendInput): Promise<void> {
    const template = renderTemplate(notification.kind, notification.payload);
    console.log(`[notify:console] to=${notification.recipient} kind=${notification.kind} subject="${template.subject}"`);
  }
}
