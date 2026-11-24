import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ROLE,
  EXPECTED_APP_GRANTS,
  GRANT_MATRIX_QUERY,
  compareGrants,
  type GrantRow,
} from "@/server/db/grants";
import { createTestDb, type TestDb } from "./helpers/test-db";

// Runs the real migrations in PGlite and checks the app role's actual
// privileges against the expected matrix. The same query and comparison run
// against the real Neon branches with `pnpm db:check-grants`.

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function grantRows(): Promise<GrantRow[]> {
  return (await t.client.query<GrantRow>(GRANT_MATRIX_QUERY)).rows;
}

describe("app role privileges (grant matrix)", () => {
  it("match the expected matrix exactly, for every table in public", async () => {
    expect(compareGrants(await grantRows())).toEqual([]);
  });

  it("covers every table defined by the migrations", async () => {
    const tables = (await grantRows()).map((r) => r.table_name).sort();
    expect(tables).toEqual(Object.keys(EXPECTED_APP_GRANTS).sort());
  });

  it("fails on a table that isn't in the matrix", async () => {
    await t.client.exec(`CREATE TABLE unlisted_table (id int)`);
    try {
      expect(compareGrants(await grantRows())).toContain(
        'table "unlisted_table" is not listed in EXPECTED_APP_GRANTS',
      );
    } finally {
      await t.client.exec(`DROP TABLE unlisted_table`);
    }
  });

  it("fails on an extra privilege", async () => {
    await t.client.exec(`GRANT INSERT ON answer_key TO ${APP_ROLE}`);
    try {
      expect(compareGrants(await grantRows())).toContain(`answer_key: ${APP_ROLE} has INSERT`);
    } finally {
      await t.client.exec(`REVOKE INSERT ON answer_key FROM ${APP_ROLE}`);
    }
  });

  it("has no superuser-like attributes and can't log in until a password is set", async () => {
    const role = (
      await t.client.query<Record<string, boolean>>(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
           FROM pg_roles WHERE rolname = '${APP_ROLE}'`,
      )
    ).rows[0];
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      rolreplication: false,
      rolcanlogin: false,
    });
  });

  it("really can't write the answer key, but can read it (as the app role)", async () => {
    await t.client.exec(`SET ROLE ${APP_ROLE}`);
    try {
      await expect(t.client.query(`SELECT count(*) FROM answer_key`)).resolves.toBeDefined();
      await expect(
        t.client.query(
          `INSERT INTO answer_key (question_id, correct_option_id, explanation) VALUES ('fake-q', 'fake-a', 'FAKE')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(t.client.query(`DELETE FROM answer_key`)).rejects.toThrow(/permission denied/);
      await expect(t.client.query(`CREATE TABLE sneaky (id int)`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await t.client.exec(`RESET ROLE`);
    }
  });
});
