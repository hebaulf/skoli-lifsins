import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requestResetFlow, signInFlow, signUpFlow } from "@/server/auth/flows";
import { DataAccessError, createDal } from "@/server/dal/dal";
import * as s from "@/server/db/schema";
import { installConsoleSanitizer, safeErrorLine } from "@/server/log/safe-log";
import { onRequestError } from "@/instrumentation";
import { GOOD_PASSWORD, createTestAuth, mockPwnedApi, type TestAuth } from "./helpers/test-auth";

// A database error in a query that contains an email address must never put
// the email (or the SQL) into ANY log output. All data is fake.

const LEAK_EMAIL = "leak-check-7f3a@example.invalid";
const REQUEST_ID = "3f2a9c1e-0000-4000-8000-1234567890ab";

let t: TestAuth;
const output: string[] = [];
const record = (...args: unknown[]) =>
  output.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 10 }))).join(" "));

beforeAll(async () => {
  // Capture EVERYTHING that could reach the logs, then sanitize console.error
  // and console.warn exactly as instrumentation.register() does in production.
  console.error = record;
  console.warn = record;
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "info").mockImplementation(record);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (record(String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (record(String(chunk)), true));
  installConsoleSanitizer(console);
  t = await createTestAuth();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t.close();
});

beforeEach(() => {
  mockPwnedApi();
  output.length = 0;
});

const logs = () => output.join("\n");

function expectClean() {
  const text = logs();
  expect(text).not.toContain(LEAK_EMAIL);
  expect(text).not.toMatch(/failed query|params:|select .* from/i);
}

describe("sanitized error logging", () => {
  it("(sanity) the raw database error really contains the email", async () => {
    await t.asOwner(() => t.client.exec(`REVOKE SELECT ON "user" FROM app_runtime`));
    const raw = await t.db
      .select()
      .from(s.user)
      .where(eq(s.user.email, LEAK_EMAIL))
      .catch((e: unknown) => e);
    expect(inspect(raw, { depth: 10 })).toContain(LEAK_EMAIL);
    expect(inspect(raw, { depth: 10 })).toMatch(/permission denied/);
  });

  it("auth flows: users get generic results, the logs get one sanitized line", async () => {
    // SELECT on "user" is revoked (previous test): every lookup by email fails.
    const ctx = { ...t.ctx(), requestId: REQUEST_ID };
    expect(await signInFlow(ctx, { email: LEAK_EMAIL, password: GOOD_PASSWORD })).toEqual({
      status: "invalid",
    });
    expect(
      await requestResetFlow({ ...t.ctx(), requestId: REQUEST_ID }, { email: LEAK_EMAIL }),
    ).toBe("sent");
    expect(
      await signUpFlow({ ...t.ctx(), requestId: REQUEST_ID }, "student", {
        name: "Leak Check",
        email: LEAK_EMAIL,
        password: GOOD_PASSWORD,
      }),
    ).toBe("error");
    expectClean();
    expect(logs()).toMatch(
      new RegExp(`\\[error\\] op=auth\\.signIn kind=\\w+ code=\\S+ request=${REQUEST_ID}`),
    );
    expect(logs()).toMatch(/\[error\] op=auth\.signUp kind=\w+ code=\S+/);
  });

  it("DAL: a database error becomes a generic DataAccessError and one sanitized line", async () => {
    await t.asOwner(() => t.client.exec(`REVOKE SELECT ON teacher_group FROM app_runtime`));
    const dal = createDal(t.db);
    const error = await dal
      .listGroups({ userId: LEAK_EMAIL, role: "teacher", mfaVerified: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataAccessError);
    expect((error as Error).cause).toBeUndefined();
    expect(inspect(error, { depth: 10 })).not.toMatch(/select|permission denied/i);
    expect(logs()).toMatch(/\[error\] op=dal\.listGroups kind=\w+ code=42501 request=-/);
    expectClean();
  });

  it("errors that escape are logged sanitized (onRequestError + console fallback)", async () => {
    const raw = await t.db
      .select()
      .from(s.user)
      .where(eq(s.user.email, LEAK_EMAIL))
      .catch((e: unknown) => e);
    // What Next.js does with an unhandled error: hook + its own console.error.
    await onRequestError(
      raw,
      { path: "/heim", method: "GET", headers: { "x-request-id": REQUEST_ID } },
      {
        routerKind: "App Router",
        routePath: "/heim",
        routeType: "render",
        revalidateReason: undefined,
      },
    );
    console.error("⨯", raw);
    console.warn(`something about ${LEAK_EMAIL}`, { user: { email: LEAK_EMAIL } });
    expectClean();
    expect(logs()).toContain(`[error] op=render:/heim kind=`);
    expect(logs()).toContain(`request=${REQUEST_ID}`);
  });

  it("Better Auth's own logger is sanitized too", async () => {
    const raw = await t.db
      .select()
      .from(s.user)
      .where(eq(s.user.email, LEAK_EMAIL))
      .catch((e: unknown) => e);
    const context = await t.auth.$context;
    context.logger.error(`Failed to look up ${LEAK_EMAIL}`, raw);
    context.logger.warn("plain warning", { email: LEAK_EMAIL });
    expectClean();
    expect(logs()).toContain("better-auth error:");
  });

  it("the sanitized line contains only operation, class, code and request id", () => {
    const line = safeErrorLine(
      "dal.getMe",
      Object.assign(new Error(`x ${LEAK_EMAIL}`), { code: "42501" }),
      REQUEST_ID,
    );
    expect(line).toBe(`[error] op=dal.getMe kind=Error code=42501 request=${REQUEST_ID}`);
    expect(safeErrorLine("bad op; rm -rf", new Error("x"), "evil\nid")).toBe(
      "[error] op=unknown kind=Error code=- request=-",
    );
  });
});
