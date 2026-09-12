import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/session";

/**
 * Edge-safe gate: only checks whether the `bk_session` cookie is present,
 * since the edge runtime cannot reach the database. Actual session
 * validity and the operator check happen in `getSession()` /
 * `requireOperatorSession()`, called from the `(portal)` and `(admin)`
 * layouts. `/api/*` (webhooks, cron) is excluded by the matcher below so
 * this never runs in front of the webhook route's raw-body signature
 * verification.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*", "/admin/:path*"],
};
