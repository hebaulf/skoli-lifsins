/**
 * The ONLY Better Auth HTTP endpoints we expose: the two links in our emails.
 * Everything else (sign-up, sign-in, update-user, get-session, two-factor,
 * ...) is 404 over HTTP and reachable only through our server actions, which
 * validate input, rate-limit and return generic answers.
 */
const ALLOWED_GET = [
  /^\/api\/auth\/verify-email$/,
  /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{1,256}$/,
];

export function isAllowedAuthRequest(method: string, pathname: string): boolean {
  return method === "GET" && ALLOWED_GET.some((pattern) => pattern.test(pathname));
}
