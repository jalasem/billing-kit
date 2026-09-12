import { ConsoleNotifier } from "./console";
import { ResendNotifier } from "./resend";
import type { Notifier } from "./types";

/** `resend` when `RESEND_API_KEY` is set, otherwise the `console` default. Shared by the dunning job and the auth magic-link flow. */
export function defaultNotifier(): Notifier {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return new ConsoleNotifier();
  }
  return new ResendNotifier({ apiKey, from: process.env.RESEND_FROM ?? "billing@example.com" });
}
