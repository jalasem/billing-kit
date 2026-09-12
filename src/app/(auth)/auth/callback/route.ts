import { NextResponse } from "next/server";
import { consumeMagicLink, InvalidMagicLinkError, isOperatorEmail, startSession } from "@/core/auth";
import { db } from "@/db/client";

function safeNext(value: string | null): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  return value;
}

/**
 * Consumes a magic-link token, starts a session, and redirects into the
 * app. Operators (email listed in `OPERATOR_EMAILS`) land in `/admin` by
 * default; everyone else lands in `/portal` — either overridden by a
 * same-origin `next` carried through from the original login request.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const next = safeNext(url.searchParams.get("next"));

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  try {
    const { email, customer } = await consumeMagicLink(db, token);
    const isOperator = isOperatorEmail(email);
    await startSession({ email, customerId: customer.id, isOperator });

    const destination = next ?? (isOperator ? "/admin" : "/portal");
    return NextResponse.redirect(new URL(destination, request.url));
  } catch (error) {
    if (error instanceof InvalidMagicLinkError) {
      return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
    }
    throw error;
  }
}
