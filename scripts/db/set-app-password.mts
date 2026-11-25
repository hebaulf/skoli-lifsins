/**
 * Enables login for the app role (app_runtime) on the Neon branch and sets
 * its password. Run by a human, never by Claude, with values from 1Password:
 *
 *   ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/dev-admin-url' \
 *   APP_DB_PASSWORD='op://skoli-lifsins/Neon/dev-app-password' \
 *   op run -- pnpm db:set-app-password
 *
 * Never prints the password, the statement or the connection string.
 * Requires Node 24 (runs this TypeScript file directly).
 */
import pg from "pg";
import {
  appPasswordProblems,
  buildSetAppPasswordStatement,
} from "../../src/server/db/app-password.ts";
import { checkConnectionUrl } from "../../src/server/db/connection-url.ts";
import { APP_ROLE } from "../../src/server/db/grants.ts";
import { assertVerifiedTls } from "../../src/server/db/tls.ts";

function fail(lines: string[]): never {
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

const adminUrl = process.env.ADMIN_DATABASE_URL ?? "";
const password = process.env.APP_DB_PASSWORD;

const urlProblems = adminUrl
  ? checkConnectionUrl(adminUrl, "admin").map((p) => `ADMIN_DATABASE_URL ${p}`)
  : ["ADMIN_DATABASE_URL is missing"];
const problems = [...urlProblems, ...appPasswordProblems(password)];
if (problems.length > 0) {
  console.error("db:set-app-password: refusing to run:");
  fail(problems);
}
try {
  assertVerifiedTls(adminUrl);
} catch {
  fail(["ADMIN_DATABASE_URL: TLS certificate verification would not be enabled"]);
}

// Built only after validation; never printed or logged.
const statement = buildSetAppPasswordStatement(password!);
const host = new URL(adminUrl).hostname;

const client = new pg.Client({ connectionString: adminUrl, enableChannelBinding: true });
try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", [
    APP_ROLE,
  ]);
  if (exists.rowCount !== 1) {
    fail([`${APP_ROLE} doesn't exist on this branch yet. Run pnpm db:migrate first.`]);
  }
  await client.query(statement);
  console.log(`Login enabled and password set for ${APP_ROLE} on ${host}.`);
  console.log("Next: pnpm db:check-grants (see docs/PLAN.md, Phase 2, step C).");
} catch (error) {
  // Only the SQLSTATE code: driver messages could echo connection details.
  const code = (error as { code?: string }).code ?? "unknown";
  fail([`Database error (SQLSTATE ${code}). Nothing was printed or logged.`]);
} finally {
  await client.end().catch(() => {});
}
