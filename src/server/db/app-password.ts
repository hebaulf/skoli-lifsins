/**
 * Password rules for the app role and the ONLY way to build the statement
 * that sets it (used by `pnpm db:set-app-password`).
 *
 * Postgres can't take a bind parameter in ALTER ROLE, and Neon doesn't accept
 * pre-hashed passwords, so the password goes into the SQL text. It's validated
 * FIRST: letters and digits only (nothing that could end the string literal
 * or inject SQL), 32+ characters (~190 bits; Neon requires >= 60).
 * Callers must never print or log the statement or the password.
 *
 * Plain module, no "server-only": used by the script outside Next.js.
 */
import { APP_ROLE } from "./grants.ts";

export const APP_PASSWORD_MIN_LENGTH = 32;

/** Problems with the password (empty = OK). Never includes the value. */
export function appPasswordProblems(password: string | undefined): string[] {
  if (!password) return ["APP_DB_PASSWORD is missing"];
  const problems: string[] = [];
  if (password.length < APP_PASSWORD_MIN_LENGTH) {
    problems.push(`APP_DB_PASSWORD must be at least ${APP_PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/^[A-Za-z0-9]+$/.test(password)) {
    problems.push("APP_DB_PASSWORD may contain only letters A–Z, a–z and digits 0–9");
  }
  return problems;
}

/** Builds the statement. Throws (without the value) if the password is invalid. */
export function buildSetAppPasswordStatement(password: string): string {
  if (appPasswordProblems(password).length > 0) {
    throw new Error("Refusing to build the statement: invalid password.");
  }
  return `ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password}'`;
}
