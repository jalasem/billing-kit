import { and, eq, gt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notify } from "@/core/notify/send";
import { ConsoleNotifier, type Notifier } from "@/core/notify";
import { magicLinks, type Customer } from "@/db/schema";
import { ensureCustomerByEmail } from "./ensure-customer";
import { RateLimitedError, InvalidMagicLinkError } from "./errors";
import { safeNext } from "./safe-next";
import { generateToken, hashToken } from "./tokens";

const LINK_TTL_MS = 15 * 60 * 1000;
const MAX_LINKS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface RequestMagicLinkOptions {
  now?: Date;
  notifier?: Notifier;
  appUrl?: string;
  /** Carried through to the callback URL so `/auth/callback` can redirect back where the user started from. */
  next?: string;
}

export interface RequestMagicLinkResult {
  customer: Customer;
  /** The raw token — only for tests that can't read a mailbox; never log or return this from a route/action. */
  token: string;
}

/**
 * Creates (or reuses) the customer for `email`, stores a 15-minute magic
 * link, and sends it through the `Notifier`. Rate limited to
 * `MAX_LINKS_PER_HOUR` requests per email per rolling hour, counted from
 * `magic_links` rows rather than a separate counter table.
 *
 * The count-then-insert is wrapped in a transaction holding an advisory
 * lock keyed by the email, so two concurrent requests for the same address
 * can't both pass the count check before either one inserts — without the
 * lock, that race lets an email exceed `MAX_LINKS_PER_HOUR`.
 */
export async function requestMagicLink(
  db: DbOrTx,
  email: string,
  options: RequestMagicLinkOptions = {},
): Promise<RequestMagicLinkResult> {
  const normalized = email.trim().toLowerCase();
  const now = options.now ?? new Date();
  const notifier = options.notifier ?? new ConsoleNotifier();
  const appUrl = options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`magic-link:request:${normalized}`}, 0))`);

    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
    const recent = await tx
      .select({ id: magicLinks.id })
      .from(magicLinks)
      .where(and(eq(magicLinks.email, normalized), gt(magicLinks.createdAt, windowStart)));
    if (recent.length >= MAX_LINKS_PER_HOUR) {
      throw new RateLimitedError(normalized);
    }

    const customer = await ensureCustomerByEmail(tx, normalized);

    const { token, hash } = generateToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
    await tx.insert(magicLinks).values({ email: normalized, tokenHash: hash, expiresAt, createdAt: now });

    const next = safeNext(options.next);
    const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
    const url = `${appUrl}/auth/callback?token=${token}${nextParam}`;
    await notify(tx, notifier, "magic_link", normalized, { url });

    return { customer, token };
  });
}

export interface ConsumeMagicLinkOptions {
  now?: Date;
}

export interface ConsumeMagicLinkResult {
  email: string;
  customer: Customer;
}

/**
 * Validates and single-uses a magic link token: must exist, be unused, and
 * be unexpired. Returns the email and customer for the caller
 * (`consumeMagicLinkToSession`, in `session.ts`) to create a session from —
 * kept separate so tests can validate the token logic without a cookie jar.
 */
export async function consumeMagicLink(db: DbOrTx, token: string, options: ConsumeMagicLinkOptions = {}): Promise<ConsumeMagicLinkResult> {
  const now = options.now ?? new Date();
  const hash = hashToken(token);

  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash)).for("update");
    if (!link) {
      throw new InvalidMagicLinkError("not_found");
    }
    if (link.usedAt) {
      throw new InvalidMagicLinkError("used");
    }
    if (link.expiresAt <= now) {
      throw new InvalidMagicLinkError("expired");
    }

    await tx.update(magicLinks).set({ usedAt: now }).where(eq(magicLinks.id, link.id));

    const customer = await ensureCustomerByEmail(tx, link.email);
    return { email: link.email, customer };
  });
}
