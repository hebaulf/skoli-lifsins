/**
 * Allow-list of routes reachable WITHOUT a session. Everything else is
 * protected: its page, route handler or server action must call
 * requireUser()/requireRole(). tests/deny-by-default.test.ts fails on any
 * page, route or action file that does neither.
 *
 * Route paths as in src/app (route groups like "(auth)" removed).
 */
export const PUBLIC_ROUTES = [
  "/",
  "/innskraning",
  "/nyskraning/nemandi",
  "/nyskraning/kennari",
  "/gleymt-lykilord",
  "/endurstilla-lykilord",
  // Second sign-in step: protected by Better Auth's short-lived 2FA cookie.
  "/tveggja-thatta",
  "/api/health",
  // Only forwards the two email-link endpoints (see the route file).
  "/api/auth/[...all]",
] as const;

/**
 * Server actions callable without a session (sign-up, sign-in, reset, the
 * 2FA sign-in step, sign-out). Each one rate-limits itself.
 */
export const PUBLIC_ACTIONS = [
  "signInAction",
  "signUpStudentAction",
  "signUpTeacherAction",
  "requestResetAction",
  "resetPasswordAction",
  "verifyTwoFactorAction",
  "signOutAction",
] as const;

export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true;
  return (PUBLIC_ROUTES as readonly string[]).includes(pathname.replace(/\/+$/, "") || "/");
}
