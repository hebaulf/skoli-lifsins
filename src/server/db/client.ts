import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "../env";
import * as schema from "./schema";
import { assertVerifiedTls } from "./tls";

let db: NodePgDatabase<typeof schema> | undefined;

/** The app's database (as app_runtime). Connects lazily, on first query. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    const { DATABASE_URL } = getEnv(); // sslmode=verify-full enforced by env validation
    assertVerifiedTls(DATABASE_URL); // and checked again against what pg will really do
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      // SCRAM-SHA-256-PLUS: binds auth to the TLS channel (pg doesn't read
      // channel_binding from the URL).
      enableChannelBinding: true,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Never log the error object: it can contain connection details, and
    // Drizzle's query errors include SQL and parameter values.
    pool.on("error", () => console.error("Database pool error (idle client)."));
    db = drizzle({ client: pool, schema });
  }
  return db;
}
