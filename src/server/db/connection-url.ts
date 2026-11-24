/**
 * Rules for Postgres connection strings, shared by the app's env validation
 * (DATABASE_URL) and the db scripts (ADMIN_DATABASE_URL).
 *
 * TLS: `sslmode=verify-full` is required. In `pg` it verifies the server
 * certificate AND hostname. Anything that could weaken that is rejected:
 * other sslmodes, `uselibpqcompat` (turns `require` into "no verification"),
 * `ssl=...` overrides. Channel binding is enabled in code (pg doesn't read
 * `channel_binding` from the URL).
 *
 * Messages describe the problem only, never the value.
 * Plain module, no "server-only": also loaded by scripts outside Next.js.
 */
import { APP_ROLE } from "./grants.ts";

export type ConnectionKind = "app" | "admin";

const FORBIDDEN_PARAMS = ["uselibpqcompat", "ssl", "sslcert", "sslkey", "sslrootcert"];

export function checkConnectionUrl(value: string, kind: ConnectionKind): string[] {
  if (!URL.canParse(value)) return ["is not a valid URL"];
  const url = new URL(value);
  const problems: string[] = [];

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    problems.push("must start with postgresql://");
  }
  if (!url.hostname) problems.push("has no host");
  if (!url.password) problems.push("has no password");

  const sslmodes = url.searchParams.getAll("sslmode");
  if (sslmodes.length !== 1 || sslmodes[0] !== "verify-full") {
    problems.push("must contain sslmode=verify-full exactly once");
  }
  for (const param of FORBIDDEN_PARAMS) {
    if (url.searchParams.has(param)) problems.push(`must not contain the ${param} parameter`);
  }

  const user = decodeURIComponent(url.username);
  if (kind === "app" && user !== APP_ROLE) {
    problems.push(`must connect as ${APP_ROLE} (the least-privilege app role)`);
  }
  if (kind === "admin" && (user === APP_ROLE || user === "")) {
    problems.push(`must connect as the owner role, not ${APP_ROLE}`);
  }
  return problems;
}
