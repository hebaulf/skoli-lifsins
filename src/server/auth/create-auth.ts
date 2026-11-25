import { AsyncLocalStorage } from "node:async_hooks";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db } from "../dal/dal";
import * as schema from "../db/schema";
import { redactText, sanitizeLogArgs } from "../log/safe-log";
import { emails, sendInBackground, type EmailTransport } from "./email";
import { consumeRateLimits, normaliseEmail } from "./rate-limit";

/** Where Better Auth sends people after clicking an email link (constants only). */
export const AUTH_PATHS = {
  login: "/innskraning",
  afterVerify: "/innskraning?stada=stadfest",
  resetForm: "/endurstilla-lykilord",
  forgot: "/gleymt-lykilord",
} as const;

export const SESSION_SECONDS = 7 * 24 * 60 * 60; // students and teachers
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60; // admins, absolute
export const RESET_TOKEN_SECONDS = 15 * 60;
export const VERIFY_TOKEN_SECONDS = 24 * 60 * 60;

/**
 * The role a sign-up creates, set ONLY by our server actions (from the
 * sign-up path). Read by the user.create hook; anything else gets "student".
 */
export const signUpRole = new AsyncLocalStorage<"student" | "teacher">();

export type AuthDeps = {
  db: Db;
  secret: string;
  baseURL: string;
  transport: EmailTransport;
  /** nextCookies() sets cookies from server actions; off in tests. */
  nextJsCookies: boolean;
};

export function createAuth(deps: AuthDeps) {
  const { db, secret, baseURL, transport } = deps;
  const url = (path: string) => `${baseURL}${path}`;

  // Per-recipient limit for every email the sign-up form can trigger, so it
  // can't be used to flood someone's inbox.
  const allowEmailTo = (scope: string, email: string, limit: number) =>
    consumeRateLimits(db, secret, [
      { scope: `email-to:${scope}`, value: normaliseEmail(email), limit, windowSeconds: 86_400 },
    ]);

  const auth = betterAuth({
    appName: "Skóli lífsins",
    // Links are built from this, never from the request's Host header.
    baseURL,
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    // Better Auth's own log output is sanitized like everything else: error
    // objects become class/code only, text is redacted (no SQL, emails, tokens).
    logger: {
      level: "warn",
      log: (level, message, ...args) => {
        const line = [
          `better-auth ${level}: ${redactText(String(message))}`,
          ...sanitizeLogArgs(args),
        ];
        if (level === "error") console.error(...line);
        else console.warn(...line);
      },
    },
    // Our own limiter covers every server action; the only HTTP endpoints we
    // expose are the token-guarded email links (src/app/api/auth/[...all]).
    rateLimit: { enabled: false },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true, // also makes sign-up identical for existing emails
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url: link }) => {
        if (await allowEmailTo("reset", user.email, 5)) {
          sendInBackground(transport, emails.resetPassword(user.email, link));
        }
      },
      onExistingUserSignUp: async ({ user }) => {
        if (!(await allowEmailTo("existing", user.email, 2))) return;
        if (!user.emailVerified) {
          // Never verified: send a fresh verification link instead of a notice.
          await auth.api.sendVerificationEmail({
            body: { email: user.email, callbackURL: AUTH_PATHS.afterVerify },
          });
          return;
        }
        sendInBackground(
          transport,
          emails.accountExists(user.email, url(AUTH_PATHS.login), url(AUTH_PATHS.forgot)),
        );
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: VERIFY_TOKEN_SECONDS,
      sendVerificationEmail: async ({ user, url: link }) => {
        if (await allowEmailTo("verify", user.email, 3)) {
          sendInBackground(transport, emails.verifyEmail(user.email, link));
        }
      },
    },

    session: {
      expiresIn: SESSION_SECONDS,
      // Absolute lifetimes: activity never extends a session.
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },

    user: {
      additionalFields: {
        // Never accepted from input: ignored on sign-up, rejected on update.
        role: {
          type: ["student", "teacher", "admin"],
          required: false,
          defaultValue: "student",
          input: false,
        },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },

    advanced: {
      // Don't store IPs on sessions (data minimisation); rate limiting uses
      // our own proxy-aware getClientIp().
      ipAddress: { disableIpTracking: true },
      useSecureCookies: baseURL.startsWith("https://"),
    },

    databaseHooks: {
      user: {
        create: {
          // The role comes only from our sign-up action (never "admin").
          before: async (newUser) => ({
            data: { ...newUser, role: signUpRole.getStore() ?? "student" },
          }),
        },
      },
      session: {
        create: {
          // Admins: 12 hours absolute (refresh is disabled for everyone).
          before: async (newSession) => {
            const [owner] = await db
              .select({ role: schema.user.role })
              .from(schema.user)
              .where(eq(schema.user.id, newSession.userId));
            if (owner?.role !== "admin") return { data: newSession };
            const created = new Date(newSession.createdAt ?? Date.now());
            return {
              data: {
                ...newSession,
                expiresAt: new Date(created.getTime() + ADMIN_SESSION_SECONDS * 1000),
              },
            };
          },
        },
      },
    },

    plugins: [
      // TOTP secret and backup codes are stored encrypted (plugin default).
      twoFactor({ issuer: "Skóli lífsins", skipVerificationOnEnable: false }),
      // Fails closed if the API can't be reached (checked in tests).
      haveIBeenPwned(),
      ...(deps.nextJsCookies ? [nextCookies()] : []),
    ],
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
