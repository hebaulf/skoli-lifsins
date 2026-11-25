import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./server/auth/public-routes";

/**
 * 1. Gives every request a fresh x-request-id (a client-sent value is
 *    overwritten), used to correlate sanitized log lines.
 * 2. Convenience ONLY, not a security check: sends visitors without a session
 *    cookie to the login page. It doesn't validate the cookie. Real checks are
 *    in every page, action and route (requireUser/requireRole, and the DAL).
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", crypto.randomUUID());
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (isPublicPath(request.nextUrl.pathname)) return next();
  if (getSessionCookie(request)) return next();
  // Built from APP_BASE_URL (validated at startup), never from the
  // (spoofable) Host header. Next.js requires an absolute URL here.
  const base = process.env.APP_BASE_URL;
  if (!base) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(new URL("/innskraning", base), 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
