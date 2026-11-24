/**
 * Checks a real Neon branch (step C in docs/PLAN.md, Phase 2). Run by a human,
 * never by Claude, with values from 1Password:
 *
 *   ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/<dev|demo>-admin-url' \
 *   DATABASE_URL='op://skoli-lifsins/Neon/<dev|demo>-url' \
 *   op run -- pnpm db:check-grants
 *
 * As the owner: all migrations applied, app_runtime's privileges match the
 * grant matrix exactly (src/server/db/grants.ts), no superuser-like
 * attributes, no role memberships (e.g. neon_superuser), login enabled.
 * As app_runtime (if DATABASE_URL is given): can log in and read the answer
 * key, but can't write it or create tables (inside a transaction that is
 * always rolled back).
 *
 * Prints only PASS/FAIL lines, table names and counts. Requires Node 24.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { checkConnectionUrl, type ConnectionKind } from "../../src/server/db/connection-url.ts";
import {
  APP_ROLE,
  GRANT_MATRIX_QUERY,
  compareGrants,
  type GrantRow,
} from "../../src/server/db/grants.ts";
import { assertVerifiedTls } from "../../src/server/db/tls.ts";

let failed = false;
const pass = (msg: string) => console.log(`PASS  ${msg}`);
const failLine = (msg: string) => {
  failed = true;
  console.log(`FAIL  ${msg}`);
};
const sqlstate = (e: unknown) => (e as { code?: string }).code ?? "unknown";

function validated(name: string, kind: ConnectionKind): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const problems = checkConnectionUrl(value, kind);
  try {
    assertVerifiedTls(value);
  } catch {
    problems.push("would not verify the TLS certificate");
  }
  if (problems.length > 0) {
    for (const p of problems) failLine(`${name} ${p}`);
    return undefined;
  }
  return value;
}

const adminUrl = validated("ADMIN_DATABASE_URL", "admin");
const appUrl = validated("DATABASE_URL", "app");
if (!process.env.ADMIN_DATABASE_URL) failLine("ADMIN_DATABASE_URL is missing");
if (!adminUrl) process.exit(1);

console.log(`Branch host: ${new URL(adminUrl).hostname}`);

// ---- As the owner ----
const admin = new pg.Client({ connectionString: adminUrl, enableChannelBinding: true });
try {
  await admin.connect();

  const journal = JSON.parse(
    readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as {
    entries: unknown[];
  };
  const applied = await admin
    .query<{ n: string }>("SELECT count(*) AS n FROM drizzle.__drizzle_migrations")
    .then((r) => Number(r.rows[0]?.n))
    .catch(() => 0);
  if (applied === journal.entries.length) pass(`all ${applied} migrations applied`);
  else failLine(`${applied} of ${journal.entries.length} migrations applied (run pnpm db:migrate)`);

  const problems = compareGrants((await admin.query<GrantRow>(GRANT_MATRIX_QUERY)).rows);
  if (problems.length === 0) pass(`${APP_ROLE} privileges match the grant matrix exactly`);
  else for (const p of problems) failLine(p);

  const role = (
    await admin.query<Record<string, boolean>>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
         FROM pg_catalog.pg_roles WHERE rolname = $1`,
      [APP_ROLE],
    )
  ).rows[0];
  if (!role) failLine(`${APP_ROLE} doesn't exist (run pnpm db:migrate)`);
  else {
    for (const attr of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolbypassrls",
      "rolreplication",
    ]) {
      if (role[attr]) failLine(`${APP_ROLE} has ${attr}`);
    }
    if (!role.rolcanlogin) failLine(`${APP_ROLE} can't log in (run pnpm db:set-app-password)`);
    if (Object.entries(role).every(([k, v]) => (k === "rolcanlogin" ? v : !v))) {
      pass(`${APP_ROLE} has no superuser-like attributes and can log in`);
    }
  }

  const memberships = await admin.query<{ role: string }>(
    `SELECT r.rolname AS role FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
       JOIN pg_catalog.pg_roles u ON u.oid = m.member
      WHERE u.rolname = $1`,
    [APP_ROLE],
  );
  if (memberships.rowCount === 0)
    pass(`${APP_ROLE} is not a member of any role (no neon_superuser)`);
  else failLine(`${APP_ROLE} is a member of: ${memberships.rows.map((r) => r.role).join(", ")}`);
} catch (e) {
  failLine(`owner checks: database error (SQLSTATE ${sqlstate(e)})`);
} finally {
  await admin.end().catch(() => {});
}

// ---- As the app role ----
if (!appUrl) {
  if (!process.env.DATABASE_URL) console.log("SKIP  app-role checks (DATABASE_URL not given)");
} else {
  const app = new pg.Client({ connectionString: appUrl, enableChannelBinding: true });
  try {
    await app.connect();
    const who = await app.query<{ u: string }>("SELECT current_user AS u");
    if (who.rows[0]?.u === APP_ROLE) pass(`DATABASE_URL logs in as ${APP_ROLE}`);
    else failLine("DATABASE_URL logs in as a different role");

    await app.query("SELECT count(*) FROM answer_key");
    pass("app role can read answer_key");

    await app.query("BEGIN");
    for (const [what, sql] of [
      [
        "insert into answer_key",
        "INSERT INTO answer_key (question_id, correct_option_id, explanation) VALUES ('check-fake', 'check-fake', 'check')",
      ],
      ["update answer_key", "UPDATE answer_key SET explanation = explanation"],
      ["delete from answer_key", "DELETE FROM answer_key"],
      ["create a table", "CREATE TABLE grants_check_fake (id int)"],
    ] as const) {
      await app.query("SAVEPOINT s");
      try {
        await app.query(sql);
        failLine(`app role CAN ${what}`);
      } catch (e) {
        if (sqlstate(e) === "42501") pass(`app role can't ${what} (permission denied)`);
        else failLine(`app role: ${what} failed unexpectedly (SQLSTATE ${sqlstate(e)})`);
      }
      await app.query("ROLLBACK TO SAVEPOINT s");
    }
    await app.query("ROLLBACK");
  } catch (e) {
    failLine(`app-role checks: database error (SQLSTATE ${sqlstate(e)})`);
  } finally {
    await app.end().catch(() => {});
  }
}

console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: all checks passed");
process.exit(failed ? 1 : 0);
