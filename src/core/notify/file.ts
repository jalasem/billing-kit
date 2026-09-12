import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Notifier, NotifierSendInput } from "./types";

/**
 * Test-only notifier: writes each notification's full payload to a JSON
 * file under `dir`, one file per (kind, recipient), overwriting on every
 * send. Lets a Playwright spec read the raw magic-link URL directly
 * instead of a real mailbox or the `notifications` table — whose payload
 * is redacted for sensitive kinds by `notify()` (see `send.ts`) precisely
 * so a token is never sitting in the database. Never wired up unless
 * explicitly enabled — see `magicLinkNotifier()` in `default.ts`.
 */
export class FileNotifier implements Notifier {
  readonly channel = "file";
  private readonly dir: string;

  constructor(dir = "e2e/.auth") {
    this.dir = dir;
  }

  async send(notification: NotifierSendInput): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${notification.kind}-${encodeURIComponent(notification.recipient)}.json`);
    await writeFile(file, JSON.stringify(notification.payload), "utf8");
  }
}
