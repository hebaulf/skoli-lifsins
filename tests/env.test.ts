import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/env";

const valid = { NODE_ENV: "production", APP_BASE_URL: "https://14.vibe.smelltuher.is" };

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts a minimal valid production environment", () => {
    const env = parseEnv(valid);
    expect(env.APP_BASE_URL).toBe("https://14.vibe.smelltuher.is");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("fails when APP_BASE_URL is missing", () => {
    expect(problemsOf({ NODE_ENV: "production" })).toEqual(["APP_BASE_URL is missing"]);
  });

  it("fails when APP_BASE_URL is not a URL", () => {
    expect(problemsOf({ ...valid, APP_BASE_URL: "not-a-url" })).toEqual([
      "APP_BASE_URL has an invalid value",
    ]);
  });

  it("requires https in production but allows http in development", () => {
    expect(problemsOf({ ...valid, APP_BASE_URL: "http://example.is" })).toEqual([
      "APP_BASE_URL must use https in production",
    ]);
    expect(
      parseEnv({ NODE_ENV: "development", APP_BASE_URL: "http://localhost:3000" }).APP_BASE_URL,
    ).toBe("http://localhost:3000");
  });

  it("strips a trailing slash from APP_BASE_URL", () => {
    expect(parseEnv({ ...valid, APP_BASE_URL: "https://example.is/" }).APP_BASE_URL).toBe(
      "https://example.is",
    );
  });

  it("validates optional variables when they are set", () => {
    expect(problemsOf({ ...valid, DATABASE_URL: "mysql://x" })).toEqual([
      "DATABASE_URL has an invalid value",
    ]);
    expect(problemsOf({ ...valid, BETTER_AUTH_SECRET: "too-short" })).toEqual([
      "BETTER_AUTH_SECRET has an invalid value",
    ]);
  });

  it.each([
    ["APP_BASE_URL", "https://example.is/a b"],
    ["DATABASE_URL", "postgres://u:p@host/db extra"],
    ["BETTER_AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz012345 6789"],
    ["RESEND_API_KEY", "re_abc def"],
    ["EMAIL_FROM", "Skóli lífsins <no-reply@example.is>"],
    ["SANITY_PROJECT_ID", "abc def"],
    ["SANITY_DATASET", "demo\n"],
    ["SANITY_READ_TOKEN", "\tsk-token"],
    ["NODE_ENV", "production "],
  ])("rejects whitespace in %s with a single clear message", (key, value) => {
    expect(problemsOf({ ...valid, [key]: value })).toEqual([`${key} must not contain whitespace`]);
  });

  it("rejects leading/trailing whitespace instead of trimming it", () => {
    expect(problemsOf({ ...valid, APP_BASE_URL: " https://example.is" })).toEqual([
      "APP_BASE_URL must not contain whitespace",
    ]);
  });

  it("reports whitespace and other problems together", () => {
    expect(problemsOf({ NODE_ENV: "production", RESEND_API_KEY: "a b" })).toEqual([
      "RESEND_API_KEY must not contain whitespace",
      "APP_BASE_URL is missing",
    ]);
  });

  it("accepts EMAIL_FROM as a bare address only", () => {
    expect(parseEnv({ ...valid, EMAIL_FROM: "no-reply@example.is" }).EMAIL_FROM).toBe(
      "no-reply@example.is",
    );
    expect(problemsOf({ ...valid, EMAIL_FROM: "Skóli<no-reply@example.is>" })).toEqual([
      "EMAIL_FROM has an invalid value",
    ]);
  });

  it("accepts special characters without whitespace", () => {
    expect(
      parseEnv({ ...valid, DATABASE_URL: "postgres://u:p%3C%3E@host/db?sslmode=require&x=y" })
        .DATABASE_URL,
    ).toBe("postgres://u:p%3C%3E@host/db?sslmode=require&x=y");
  });

  it("never includes a value with whitespace in the error message", () => {
    const secret = "sk-very secret-token";
    try {
      parseEnv({ ...valid, SANITY_READ_TOKEN: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("never includes the received value in the error message", () => {
    const secret = "postgres-but-wrong-sup3r-s3cret-value";
    try {
      parseEnv({ ...valid, DATABASE_URL: secret, BETTER_AUTH_SECRET: "short-s3cret" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain("short-s3cret");
    }
  });
});
