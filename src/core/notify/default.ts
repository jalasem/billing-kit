import { ConsoleNotifier } from "./console";
import { FileNotifier } from "./file";
import { ResendNotifier } from "./resend";
import type { Notifier } from "./types";

/** `resend` when `RESEND_API_KEY` is set, otherwise the `console` default. Shared by the dunning job and (via `magicLinkNotifier`) the auth magic-link flow. */
export function defaultNotifier(): Notifier {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return new ConsoleNotifier();
  }
  return new ResendNotifier({ apiKey, from: process.env.RESEND_FROM ?? "billing@example.com" });
}

/**
 * The notifier the magic-link login flow sends through. With
 * `E2E_TOKEN_SINK=1` set, this is a `FileNotifier` writing to `e2e/.auth/`
 * so the Playwright suite can read a login URL without a mailbox and
 * without the (now-redacted) `notifications` table — see
 * `src/core/notify/file.ts`. Otherwise it's `defaultNotifier()`.
 *
 * Deliberately gated on `E2E_TOKEN_SINK` alone, not also
 * `NODE_ENV !== "production"`: `next build` always compiles with
 * `NODE_ENV=production` baked in via webpack's `DefinePlugin` (see
 * `next/dist/cli/next-build`), and that literal survives into the running
 * `next start` process regardless of what `NODE_ENV` is set to at start
 * time — so an `AND` with it would silently never trigger for the built
 * app the e2e suite actually runs against (`pnpm build && pnpm start`).
 * `E2E_TOKEN_SINK` itself is safe to gate on alone: it is never set by a
 * real deployment, only by `playwright.config.ts`'s `webServer.env`.
 */
export function magicLinkNotifier(): Notifier {
  if (process.env.E2E_TOKEN_SINK === "1") {
    return new FileNotifier();
  }
  return defaultNotifier();
}
