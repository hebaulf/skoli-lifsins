/**
 * Creates an admin on the Neon branch. The ONLY way an admin can exist: the
 * app's database role is blocked from creating or promoting admins by a
 * trigger (drizzle/0003_…). Run by a human, never by Claude:
 *
 *   ADMIN_DATABASE_URL='op://skoli-lifsins/Neon/dev-admin-url' \
 *   BETTER_AUTH_SECRET='op://skoli-lifsins/BetterAuth/dev-secret' \
 *   ADMIN_EMAIL='op://skoli-lifsins/Admin/email' \
 *   ADMIN_PASSWORD='op://skoli-lifsins/Admin/dev-password' \
 *   op run -- pnpm admin:create
 *
 * Uses Better Auth itself to create the account (same password hashing and
 * Have I Been Pwned check as the app), then sets role=admin and marks the
 * email verified over the OWNER connection. Refuses if the email exists.
 * The admin must set up TOTP 2FA at first sign-in (the app forces it).
 * Prints no passwords, secrets or connection strings. Requires Node 24.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { haveIBeenPwned } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { checkConnectionUrl } from "../../src/server/db/connection-url.ts";
import * as schema from "../../src/server/db/schema.ts";
import { assertVerifiedTls } from "../../src/server/db/tls.ts";

function fail(lines: string[]): never {
  console.error("admin:create: nothing was changed.");
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

const adminUrl = process.env.ADMIN_DATABASE_URL ?? "";
const secret = process.env.BETTER_AUTH_SECRET ?? "";
const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";

const problems = [
  ...(adminUrl
    ? checkConnectionUrl(adminUrl, "admin").map((p) => `ADMIN_DATABASE_URL ${p}`)
    : ["ADMIN_DATABASE_URL is missing"]),
  ...(secret.length >= 32 ? [] : ["BETTER_AUTH_SECRET is missing or shorter than 32 characters"]),
  ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [] : ["ADMIN_EMAIL is missing or not an email"]),
  ...(password.length >= 16 && password.length <= 128
    ? []
    : ["ADMIN_PASSWORD must be 16–128 characters (use the 1Password generator)"]),
];
if (problems.length > 0) fail(problems);
try {
  assertVerifiedTls(adminUrl);
} catch {
  fail(["ADMIN_DATABASE_URL: TLS certificate verification would not be enabled"]);
}

const pool = new pg.Pool({ connectionString: adminUrl, enableChannelBinding: true, max: 2 });
const db = drizzle({ client: pool, schema });
const sqlstate = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } }).cause?.code ??
  (e as { code?: string }).code ??
  "unknown";

try {
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (existing) fail(["a user with ADMIN_EMAIL already exists on this branch"]);

  const auth = betterAuth({
    baseURL: "https://admin-seed.invalid", // no emails are sent by this script
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 16,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: {
          type: ["student", "teacher", "admin"],
          required: false,
          defaultValue: "student",
          input: false,
        },
      },
    },
    plugins: [haveIBeenPwned()],
  });

  try {
    await auth.api.signUpEmail({ body: { name: "Stjórnandi", email, password } });
  } catch (e) {
    const code = (e as { body?: { code?: string } }).body?.code;
    fail([
      code === "PASSWORD_COMPROMISED"
        ? "ADMIN_PASSWORD appears in a known data breach (Have I Been Pwned): generate a new one"
        : `could not create the account${code ? ` (${code})` : ""} – e.g. Have I Been Pwned unreachable; try again`,
    ]);
  }

  // Owner connection: the trigger allows this only for the owner role.
  const promoted = await db
    .update(schema.user)
    .set({ role: "admin", emailVerified: true, updatedAt: new Date() })
    .where(eq(schema.user.email, email))
    .returning({ id: schema.user.id });
  if (promoted.length !== 1) fail(["the new account could not be found after sign-up"]);
  await db.delete(schema.session).where(eq(schema.session.userId, promoted[0]!.id));

  console.log(`Admin created on ${new URL(adminUrl).hostname}.`);
  console.log("Next: sign in on the site; you'll be sent to set up two-factor authentication.");
} catch (e) {
  fail([`database error (SQLSTATE ${sqlstate(e)})`]);
} finally {
  await pool.end().catch(() => {});
}
