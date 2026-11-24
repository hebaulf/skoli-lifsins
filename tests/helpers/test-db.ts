import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

/**
 * A fresh in-process Postgres (PGlite) with ALL real migrations from drizzle/
 * applied, including the app role and its grants. No network, no secrets.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  return { client, db, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
