import "server-only";
import { z } from "zod";

/**
 * Server environment variables, validated with Zod.
 *
 * - Values come only from the runtime environment (Dokku config in production,
 *   .env locally). Never from build args, never from NEXT_PUBLIC_ variables.
 * - Variables belonging to later phases are optional until the phase that uses
 *   them; docs/PLAN.md says in each phase which one to make required here.
 * - Error messages list variable NAMES only, never values, so a secret can't
 *   end up in a log.
 */

const nonEmpty = z.string().trim().min(1);

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
    EMAIL_FROM: nonEmpty.optional(),

    // Phase 5 – Sanity (private dataset, read-only token). Make required in Phase 5.
    SANITY_PROJECT_ID: nonEmpty.optional(),
    SANITY_DATASET: nonEmpty.optional(),
    SANITY_READ_TOKEN: nonEmpty.optional(),
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

/** Parse and validate an environment object. Throws EnvValidationError. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only the variable name and a generic reason – never the received value.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(root)";
      const reason =
        issue.code === "invalid_type" && issue.input === undefined
          ? "is missing"
          : issue.code === "custom"
            ? issue.message
            : "has an invalid value";
      return `${name} ${reason}`;
    });
    throw new EnvValidationError(problems);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated server environment. Validated once, then cached. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
