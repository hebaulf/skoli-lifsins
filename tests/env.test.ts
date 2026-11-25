import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/env";

// Fake connection string in the required shape (app role, verify-full).
const FAKE_DB_URL =
  "postgresql://app_runtime:FakePassw0rdFakePassw0rdFakePassw0rd@db.example.invalid/neondb?sslmode=verify-full";
const FAKE_AUTH = {
  BETTER_AUTH_SECRET: "FakeSecretFakeSecretFakeSecretFakeSecret",
  RESEND_API_KEY: "re_FakeKey",
  EMAIL_FROM: "onboarding@resend.dev",
};
const valid = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://app.example.invalid",
  DATABASE_URL: FAKE_DB_URL,
  ...FAKE_AUTH,
};

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
    expect(env.APP_BASE_URL).toBe("https://app.example.invalid");
    expect(env.DATABASE_URL).toBe(FAKE_DB_URL);
  });

  it("fails when APP_BASE_URL is missing", () => {
    expect(problemsOf({ NODE_ENV: "production", DATABASE_URL: FAKE_DB_URL, ...FAKE_AUTH })).toEqual(
      ["APP_BASE_URL is missing"],
    );
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
      parseEnv({
        NODE_ENV: "development",
        APP_BASE_URL: "http://localhost:3000",
        DATABASE_URL: FAKE_DB_URL,
        ...FAKE_AUTH,
      }).APP_BASE_URL,
    ).toBe("http://localhost:3000");
  });

  it("strips a trailing slash from APP_BASE_URL", () => {
    expect(parseEnv({ ...valid, APP_BASE_URL: "https://example.is/" }).APP_BASE_URL).toBe(
      "https://example.is",
    );
  });

  it("validates optional variables when they are set", () => {
    expect(problemsOf({ ...valid, DATABASE_URL: "mysql://x" })).toContain(
      "DATABASE_URL must start with postgresql://",
    );
    expect(problemsOf({ ...valid, BETTER_AUTH_SECRET: "too-short" })).toEqual([
      "BETTER_AUTH_SECRET has an invalid value",
    ]);
  });

  describe("EMAIL_TRANSPORT", () => {
    const dev = { ...valid, NODE_ENV: "development", APP_BASE_URL: "http://localhost:3000" };
    it("defaults to resend and then requires RESEND_API_KEY", () => {
      expect(parseEnv(valid).EMAIL_TRANSPORT).toBe("resend");
      expect(problemsOf({ ...valid, RESEND_API_KEY: undefined })).toEqual([
        "RESEND_API_KEY is required when EMAIL_TRANSPORT=resend",
      ]);
    });
    it("allows console only in development on localhost (no Resend key needed)", () => {
      expect(
        parseEnv({ ...dev, EMAIL_TRANSPORT: "console", RESEND_API_KEY: undefined }).EMAIL_TRANSPORT,
      ).toBe("console");
    });
    it("refuses console in production (startup fails)", () => {
      expect(problemsOf({ ...valid, EMAIL_TRANSPORT: "console" })).toEqual([
        "EMAIL_TRANSPORT console is only allowed with NODE_ENV=development and a localhost APP_BASE_URL",
      ]);
    });
    it("refuses console in development on a non-local host (misconfigured server)", () => {
      expect(
        problemsOf({
          ...dev,
          APP_BASE_URL: "https://app.example.invalid",
          EMAIL_TRANSPORT: "console",
        }),
      ).toEqual([
        "EMAIL_TRANSPORT console is only allowed with NODE_ENV=development and a localhost APP_BASE_URL",
      ]);
    });
    it("refuses console in test mode and unknown transports", () => {
      expect(problemsOf({ ...dev, NODE_ENV: "test", EMAIL_TRANSPORT: "console" })).toHaveLength(1);
      expect(problemsOf({ ...valid, EMAIL_TRANSPORT: "smtp" })).toEqual([
        "EMAIL_TRANSPORT has an invalid value",
      ]);
    });
  });

  it.each([
    ["APP_BASE_URL", "https://example.is/a b"],
    ["DATABASE_URL", "postgres://u:p@host/db extra"],
    ["BETTER_AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz012345 6789"],
    ["RESEND_API_KEY", "re_abc def"],
    ["EMAIL_FROM", "Skóli lífsins <no-reply@example.is>"],
    ["RESEND_API_KEY", "re_abc\n"],
    ["DATABASE_URL", "\tpostgres://u:p@host/db"],
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
    expect(
      problemsOf({
        NODE_ENV: "production",
        DATABASE_URL: FAKE_DB_URL,
        ...FAKE_AUTH,
        RESEND_API_KEY: "a b",
      }),
    ).toEqual(["RESEND_API_KEY must not contain whitespace", "APP_BASE_URL is missing"]);
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
      parseEnv({ ...valid, DATABASE_URL: `${FAKE_DB_URL}&application_name=a<c>d` }).DATABASE_URL,
    ).toBe(`${FAKE_DB_URL}&application_name=a<c>d`);
  });

  it("never includes a value with whitespace in the error message", () => {
    const secret = "sk-very secret-token";
    try {
      parseEnv({ ...valid, RESEND_API_KEY: secret });
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
