import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `token_hash` is the SHA-256 hex digest of the raw token; the raw token
 * itself is never stored, only emailed via the `Notifier` (see
 * `src/core/auth/magic-link.ts`).
 */
export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;
