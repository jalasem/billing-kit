import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sessions, type Session } from "@/db/schema";

export const SESSION_COOKIE_NAME = "bk_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  email: string;
  customerId: string | null;
  isOperator: boolean;
  now?: Date;
}

/** Inserts a new session row (30-day expiry). Cookie-agnostic so it's testable without `next/headers`. */
export async function createSessionRow(db: DbOrTx, input: CreateSessionInput): Promise<Session> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const [session] = await db
    .insert(sessions)
    .values({ email: input.email, customerId: input.customerId, isOperator: input.isOperator, expiresAt })
    .returning();
  return session;
}

/** Returns the session row if it exists and has not expired, otherwise `undefined`. */
export async function getSessionRow(db: DbOrTx, sessionId: string, now: Date = new Date()): Promise<Session | undefined> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.expiresAt <= now) {
    return undefined;
  }
  return session;
}

export async function deleteSessionRow(db: DbOrTx, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
