import { isIP } from "node:net";

/**
 * The client's IP for rate limiting, behind ONE reverse proxy.
 *
 * DESIGNED FOR the course server's Dokku nginx. This repo is now a local-only
 * test setup (no proxy: locally the result is 127.0.0.1 / ::1). The trust
 * model MUST be revisited for the real project's host (docs/PLAN.md,
 * section 7): another proxy, CDN or load balancer changes which entry is
 * trustworthy.
 *
 * Trust ONLY the address added by our proxy: the LAST entry of
 * X-Forwarded-For. nginx either overwrites the header with the client address
 * or appends it ($proxy_add_x_forwarded_for); in both cases the last entry is
 * the one nginx added, and anything a client sends ends up to the left of it.
 * Next.js only fills the header (with the socket address) when it's missing,
 * so locally the result is 127.0.0.1 / ::1.
 *
 * If another proxy is ever put in front of nginx (e.g. a CDN), the last entry
 * becomes that proxy: everyone shares one bucket (stricter, never spoofable).
 * Verify on a deployed server with scripts/check/ip-rate-limit.mts.
 *
 * Returns "unknown" when there is no usable address (shared bucket).
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const last = forwarded.split(",").at(-1)?.trim() ?? "";
  return isIP(last) ? last : "unknown";
}
