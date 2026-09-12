import type { Notifier, NotifierSendInput } from "./types";

/** Test-only `Notifier` that records every send in order, for asserting on notification sequencing. */
export class RecordingNotifier implements Notifier {
  readonly channel = "recording";
  readonly sent: NotifierSendInput[] = [];

  async send(notification: NotifierSendInput): Promise<void> {
    this.sent.push(notification);
  }
}
