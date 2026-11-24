import "server-only";
import { z } from "zod";

/**
 * Server environment variables, validated with Zod.
 *
 * - Values come only from the runtime environment: Dokku config on the server,
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

    // Phase 2 – PostgreSQL (Neon). Make required in Phase 2.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

    // Phase 3 – Better Auth + Resend. Make required in Phase 3.
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    RESEND_API_KEY: nonEmpty.optional(),
    // Bare address only (e.g. no-reply@example.is). The display name
    // "Skóli lífsins" lives in code (src/server/email-sender.ts), because the
    // course Dokku server can't store values containing spaces.
    EMAIL_FROM: z.email().optional(),

    // Not here on purpose: ADMIN_DATABASE_URL (answer-key seed script, Phase 5).
    // It's only ever passed to the seed script on the developer's machine and
    // must never reach the running app or the Dokku config.
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
  // No value may contain whitespace: the course Dokku server splits config
  // values on spaces, and a stray space/newline from copy-paste is always a
  // mistake. Reject it loudly at startup instead of trimming it silently.
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
