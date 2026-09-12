import { cookies } from "next/headers";
import { db } from "@/db/client";
import type { Session } from "@/db/schema";
import { UnauthorizedError } from "./errors";
import { createSessionRow, deleteSessionRow, getSessionRow, SESSION_COOKIE_NAME, SESSION_TTL_MS, type CreateSessionInput } from "./session";

export interface CurrentSession {
  id: string;
  email: string;
  customerId: string | null;
  isOperator: boolean;
}

function toCurrentSession(session: Session): CurrentSession {
  return { id: session.id, email: session.email, customerId: session.customerId, isOperator: session.isOperator };
}

/**
 * Server helper: reads the `bk_session` cookie and validates it against
 * the database (never trusting the cookie's mere presence — that's all
 * `middleware.ts` can check at the edge). Returns `null` if the cookie is
 * absent, unknown, or expired.
 */
export async function getSession(): Promise<CurrentSession | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return null;
  }
  const session = await getSessionRow(db, sessionId);
  if (!session) {
    return null;
  }
  return toCurrentSession(session);
}

/** Throws `UnauthorizedError` unless the current session belongs to a customer. Used at the top of every portal server action. */
export async function requireCustomerSession(): Promise<CurrentSession & { customerId: string }> {
  const session = await getSession();
  if (!session || !session.customerId) {
    throw new UnauthorizedError("A customer session is required");
  }
  return session as CurrentSession & { customerId: string };
}

/** Throws `UnauthorizedError` unless the current session is an operator. Used at the top of every admin server action. */
export async function requireOperatorSession(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session || !session.isOperator) {
    throw new UnauthorizedError("An operator session is required");
  }
  return session;
}

/**
 * Creates a session row and sets the cookie. Callable only from a Server
 * Action or Route Handler (`cookies().set` throws from a Server Component
 * render). Always mints a fresh session id — login "rotates" the session
 * rather than reusing one.
 */
export async function startSession(input: CreateSessionInput): Promise<CurrentSession> {
  const session = await createSessionRow(db, input);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return toCurrentSession(session);
}

/** Clears the cookie and deletes the underlying session row, if any. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value;
  store.delete(SESSION_COOKIE_NAME);
  if (sessionId) {
    await deleteSessionRow(db, sessionId);
  }
}
