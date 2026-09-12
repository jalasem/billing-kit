import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { RecordingNotifier } from "@/core/notify";
import { notifications } from "@/db/schema";
import { resetM4Tables } from "@/test/reset-db";
import { consumeMagicLink, requestMagicLink } from "./magic-link";
import { RateLimitedError, InvalidMagicLinkError } from "./errors";

beforeEach(async () => {
  await resetM4Tables(db);
});

describe("requestMagicLink", () => {
  it("creates a customer row when none exists (portal sign-up is implicit)", async () => {
    const notifier = new RecordingNotifier();
    const { customer } = await requestMagicLink(db, "new@example.com", { notifier });
    expect(customer.email).toBe("new@example.com");
  });

  it("reuses the existing customer on a second request", async () => {
    const notifier = new RecordingNotifier();
    const first = await requestMagicLink(db, "again@example.com", { notifier });
    const second = await requestMagicLink(db, "again@example.com", { notifier });
    expect(second.customer.id).toBe(first.customer.id);
  });

  it("sends a magic_link notification carrying the callback URL with the raw token", async () => {
    const notifier = new RecordingNotifier();
    const { token } = await requestMagicLink(db, "notify@example.com", { notifier, appUrl: "https://app.test" });

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].kind).toBe("magic_link");
    expect(notifier.sent[0].recipient).toBe("notify@example.com");
    expect(notifier.sent[0].payload.url).toBe(`https://app.test/auth/callback?token=${token}`);
  });

  it("persists a redacted payload on the notifications row — the raw token and URL are never stored", async () => {
    const notifier = new RecordingNotifier();
    const { token } = await requestMagicLink(db, "redacted@example.com", { notifier, appUrl: "https://app.test" });

    const [row] = await db.select().from(notifications).where(eq(notifications.recipient, "redacted@example.com"));
    expect(row).toBeDefined();
    expect(row.payload).toEqual({ kind: "magic_link", recipient: "redacted@example.com", redacted: true });

    const serialized = JSON.stringify(row.payload);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("http");
    expect(serialized.toLowerCase()).not.toContain("url");

    // The notifier itself still received the real payload — only the DB row is redacted.
    expect(notifier.sent[0].payload.url).toBe(`https://app.test/auth/callback?token=${token}`);
  });

  it("rate limits at 5 links per email per hour", async () => {
    const notifier = new RecordingNotifier();
    const now = new Date("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      await requestMagicLink(db, "ratelimited@example.com", { notifier, now });
    }
    await expect(requestMagicLink(db, "ratelimited@example.com", { notifier, now })).rejects.toThrow(RateLimitedError);
  });

  it("does not rate limit once the hour has rolled over", async () => {
    const notifier = new RecordingNotifier();
    const now = new Date("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      await requestMagicLink(db, "later@example.com", { notifier, now });
    }
    const anHourLater = new Date(now.getTime() + 60 * 60 * 1000 + 1000);
    await expect(requestMagicLink(db, "later@example.com", { notifier, now: anHourLater })).resolves.toBeDefined();
  });
});

describe("consumeMagicLink", () => {
  it("consumes a valid token and returns the associated email/customer", async () => {
    const { token, customer } = await requestMagicLink(db, "consume@example.com", { notifier: new RecordingNotifier() });
    const result = await consumeMagicLink(db, token);
    expect(result.email).toBe("consume@example.com");
    expect(result.customer.id).toBe(customer.id);
  });

  it("is single use: a second consume of the same token fails", async () => {
    const { token } = await requestMagicLink(db, "singleuse@example.com", { notifier: new RecordingNotifier() });
    await consumeMagicLink(db, token);
    await expect(consumeMagicLink(db, token)).rejects.toThrow(InvalidMagicLinkError);
  });

  it("rejects an expired token", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { token } = await requestMagicLink(db, "expired@example.com", { notifier: new RecordingNotifier(), now });
    const sixteenMinutesLater = new Date(now.getTime() + 16 * 60 * 1000);
    await expect(consumeMagicLink(db, token, { now: sixteenMinutesLater })).rejects.toThrow(InvalidMagicLinkError);
  });

  it("rejects an unknown token", async () => {
    await expect(consumeMagicLink(db, "not-a-real-token")).rejects.toThrow(InvalidMagicLinkError);
  });
});
