import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./server/auth/public-routes";

/**
 * Convenience ONLY, not a security check: sends visitors without a session
 * cookie to the login page. It doesn't validate the cookie. Real checks are
 * in every page, action and route (requireUser/requireRole, and the DAL).
 */
export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  // Built from APP_BASE_URL (validated at startup), never from the
  // (spoofable) Host header. Next.js requires an absolute URL here.
  const base = process.env.APP_BASE_URL;
  if (!base) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(new URL("/innskraning", base), 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
