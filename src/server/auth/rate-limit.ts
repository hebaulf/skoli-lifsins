import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../dal/dal";

/**
 * Fixed-window rate limiter in Postgres, used by every auth server action
 * (Better Auth's own limiter doesn't apply to server-side `auth.api` calls).
 *
 * Keys are HMAC-SHA256(secret, scope + value): no raw email addresses or IPs
 * are stored. The check-and-increment is a single atomic upsert.
 */
export type LimitRule = {
  /** What is being limited, e.g. "sign-in:email". Part of the key. */
  scope: string;
  /** The value, e.g. a normalised email address or an IP. */
  value: string;
  limit: number;
  windowSeconds: number;
};

export function rateLimitKey(secret: string, scope: string, value: string): string {
  return createHmac("sha256", secret).update(`${scope}\u0000${value}`).digest("hex");
}

/** Counts one attempt against EVERY rule; false if any rule is over its limit. */
export async function consumeRateLimits(
  db: Db,
  secret: string,
  rules: readonly LimitRule[],
): Promise<boolean> {
  let allowed = true;
  for (const rule of rules) {
    const key = rateLimitKey(secret, rule.scope, rule.value);
    // Both drivers (pg, PGlite) return { rows }.
    const result = (await db.execute(sql`
      INSERT INTO auth_rate_limit (key, window_start, count)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN auth_rate_limit.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
          THEN 1 ELSE auth_rate_limit.count + 1 END,
        window_start = CASE
          WHEN auth_rate_limit.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
          THEN now() ELSE auth_rate_limit.window_start END
      RETURNING count`)) as unknown as { rows: { count: number | string }[] };
    const count = Number(result.rows[0]?.count ?? Number.POSITIVE_INFINITY);
    if (count > rule.limit) allowed = false;
  }
  // Occasional cleanup of long-expired windows (no cron needed).
  if (Math.random() < 0.02) {
    await db.execute(
      sql`DELETE FROM auth_rate_limit WHERE window_start < now() - interval '2 days'`,
    );
  }
  return allowed;
}

/** Normalises an email for rate-limit keys (case/whitespace-insensitive). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
