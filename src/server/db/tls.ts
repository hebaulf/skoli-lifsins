/**
 * Checks the TLS settings `pg` will ACTUALLY use for a connection string.
 * Building a Client parses the string without connecting. Throws unless the
 * server certificate is verified (never `rejectUnauthorized: false`).
 *
 * Plain module, no "server-only": also used by the db scripts.
 */
import pg from "pg";

export function assertVerifiedTls(connectionString: string): void {
  // `connectionParameters` is untyped pg internals. If a pg update removes it,
  // `ssl` is undefined and this throws: fail closed, caught by the tests.
  const client = new pg.Client({ connectionString }) as unknown as {
    connectionParameters?: { ssl?: boolean | { rejectUnauthorized?: boolean } };
  };
  const ssl = client.connectionParameters?.ssl;
  if (!ssl || (typeof ssl === "object" && ssl.rejectUnauthorized === false)) {
    throw new Error("Database TLS certificate verification is not enabled.");
  }
}
