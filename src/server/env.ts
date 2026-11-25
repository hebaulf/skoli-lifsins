import "server-only";
import { z } from "zod";
import { checkConnectionUrl } from "./db/connection-url";

/**
 * Server environment variables, validated with Zod.
 *
 * - Values come only from the runtime environment:
 *   `op run --env-file=env.1password` locally (1Password is the source of
 *   truth). Never from build args, files in the image or NEXT_PUBLIC_ variables.
 * - Variables belonging to later phases are optional until the phase that uses
 *   them; docs/PLAN.md says in each phase which one to make required here.
 * - Every variable here must also be listed in env.1password (checked by
 *   tests/env-1password.test.ts).
 * - Error messages list variable NAMES only, never values, so a secret can't
 *   end up in a log.
 */

/**
 * Variables that hold secrets. In env.1password they must be op:// references.
 * Add every new secret here (and never log these values).
 */
export const SECRET_ENV_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY"] as const;

const nonEmpty = z.string().min(1);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Phase 1 – public base URL used to build absolute links (e.g. reset/invite
    // links later). Never derive links from the Host header.
    APP_BASE_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),

    // Phase 2 – PostgreSQL (Neon), as the least-privilege app role, with
    // sslmode=verify-full (rules in src/server/db/connection-url.ts).
    DATABASE_URL: z.string().superRefine((value, ctx) => {
      for (const problem of checkConnectionUrl(value, "app")) {
        ctx.addIssue({ code: "custom", message: problem });
      }
    }),

    // Phase 3 – Better Auth. Encrypts TOTP secrets and backup codes: NEVER
    // rotate it without Better Auth's key-version mechanism (docs/PLAN.md).
    BETTER_AUTH_SECRET: z.string().min(32),

    // Phase 3 – email. "console" prints emails to the local terminal instead
    // of sending them; allowed ONLY in local development (checked below).
    EMAIL_TRANSPORT: z.enum(["resend", "console"]).default("resend"),
    // Required when EMAIL_TRANSPORT=resend (checked below).
    RESEND_API_KEY: nonEmpty.optional(),
    // Bare address only (e.g. no-reply@example.is). The display name
    // "Skóli lífsins" lives in code (src/server/email-sender.ts), because
    // config values may not contain whitespace (see parseEnv).
    EMAIL_FROM: z.email(),

    // Not here on purpose: ADMIN_DATABASE_URL (migrations, db scripts, answer
    // seed). It's only ever passed to those scripts on the developer's machine
    // via `op run` and must never reach the running app.
  })
  .superRefine((env, ctx) => {
    // Zod 4 still runs this refinement when a field already failed, so only
    // check the scheme of a value that is actually a URL (avoids a double error).
    if (
      env.NODE_ENV === "production" &&
      URL.canParse(env.APP_BASE_URL) &&
      new URL(env.APP_BASE_URL).protocol !== "https:"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must use https in production",
      });
    }

    // Console email mode would print verification and reset links to the
    // logs. Only for local development: NODE_ENV=development AND a localhost
    // base URL (a misconfigured server with NODE_ENV=development still fails).
    if (env.EMAIL_TRANSPORT === "console") {
      const host = URL.canParse(env.APP_BASE_URL) ? new URL(env.APP_BASE_URL).hostname : "";
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
      if (env.NODE_ENV !== "development" || !local) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_TRANSPORT"],
          message: "console is only allowed with NODE_ENV=development and a localhost APP_BASE_URL",
        });
      }
    }
    if (env.EMAIL_TRANSPORT === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "is required when EMAIL_TRANSPORT=resend",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

const ENV_KEYS = Object.keys(envSchema.shape);

/** Parse and validate an environment object. Throws EnvValidationError. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // No value may contain whitespace: a stray space/newline from copy-paste is
  // always a mistake (and some hosts split config values on spaces). Reject
  // it loudly at startup instead of trimming it silently.
  const withWhitespace = ENV_KEYS.filter((key) => /\s/.test(source[key] ?? ""));

  const result = envSchema.safeParse(source);
  if (!result.success || withWhitespace.length > 0) {
    // Only the variable name and a generic reason – never the received value.
    const whitespaceProblems = withWhitespace.map((key) => `${key} must not contain whitespace`);
    const issues = result.success ? [] : result.error.issues;
    const schemaProblems = issues
      // One message per variable: whitespace already explains the problem.
      .filter((issue) => !withWhitespace.includes(String(issue.path[0])))
      .map((issue) => {
        const name = issue.path.join(".") || "(root)";
        const reason =
          issue.code === "invalid_type" && issue.input === undefined
            ? "is missing"
            : issue.code === "custom"
              ? issue.message
              : "has an invalid value";
        return `${name} ${reason}`;
      });
    throw new EnvValidationError([...whitespaceProblems, ...schemaProblems]);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated server environment. Validated once, then cached. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
