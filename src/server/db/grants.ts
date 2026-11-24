/**
 * The ONLY privileges the app's database role has, per table. Explicit, no
 * default privileges. Applied by the migration in drizzle/ and checked:
 * - in tests (tests/db-grants.test.ts, PGlite with all migrations applied),
 * - against the real Neon branches (`pnpm db:check-grants`).
 * Both fail on any table in the `public` schema that isn't listed here.
 *
 * Changing this file means writing a new migration with matching GRANT/REVOKE
 * statements; the checks catch any mismatch.
 *
 * Plain data, no "server-only" import: also loaded by scripts outside Next.js.
 */
export const APP_ROLE = "app_runtime";

export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export const ALL_PRIVILEGES: readonly TablePrivilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

const READ_WRITE: readonly TablePrivilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

export const EXPECTED_APP_GRANTS: Readonly<Record<string, readonly TablePrivilege[]>> = {
  user: READ_WRITE,
  teacher_group: READ_WRITE,
  group_membership: READ_WRITE,
  invitation: READ_WRITE,
  quiz_attempt: READ_WRITE,
  chapter_progress: READ_WRITE,
  diploma: READ_WRITE,
  // The answer key is written only by the seed script (admin connection).
  answer_key: ["SELECT"],
};

/**
 * SQL that lists, for every table in `public`, which privileges the app role
 * has. Shared by the test and the real-database check.
 */
export const GRANT_MATRIX_QUERY = `
  SELECT c.relname AS table_name,
         has_table_privilege('${APP_ROLE}', c.oid, 'SELECT') AS "SELECT",
         has_table_privilege('${APP_ROLE}', c.oid, 'INSERT') AS "INSERT",
         has_table_privilege('${APP_ROLE}', c.oid, 'UPDATE') AS "UPDATE",
         has_table_privilege('${APP_ROLE}', c.oid, 'DELETE') AS "DELETE",
         has_table_privilege('${APP_ROLE}', c.oid, 'TRUNCATE') AS "TRUNCATE",
         has_table_privilege('${APP_ROLE}', c.oid, 'REFERENCES') AS "REFERENCES",
         has_table_privilege('${APP_ROLE}', c.oid, 'TRIGGER') AS "TRIGGER"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
   ORDER BY c.relname`;

export type GrantRow = { table_name: string } & Record<string, boolean>;

/** Compares actual privileges to the expected matrix; returns problems (empty = OK). */
export function compareGrants(rows: readonly GrantRow[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.table_name);
    const expected = EXPECTED_APP_GRANTS[row.table_name];
    if (!expected) {
      problems.push(`table "${row.table_name}" is not listed in EXPECTED_APP_GRANTS`);
      continue;
    }
    for (const privilege of [...ALL_PRIVILEGES, "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const want = (expected as readonly string[]).includes(privilege);
      const has = row[privilege] === true;
      if (want !== has) {
        problems.push(`${row.table_name}: ${APP_ROLE} ${has ? "has" : "lacks"} ${privilege}`);
      }
    }
  }
  for (const table of Object.keys(EXPECTED_APP_GRANTS)) {
    if (!seen.has(table)) problems.push(`table "${table}" is listed but doesn't exist`);
  }
  return problems;
}
