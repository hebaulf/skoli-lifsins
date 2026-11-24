import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_SECONDS,
  RESET_TOKEN_SECONDS,
  VERIFY_TOKEN_SECONDS,
} from "@/server/auth/create-auth";
import {
  changePasswordFlow,
  confirmTwoFactorSetupFlow,
  requestResetFlow,
  resetPasswordFlow,
  signInFlow,
  signUpFlow,
  startTwoFactorSetupFlow,
  verifyTwoFactorFlow,
} from "@/server/auth/flows";
import { evaluateSession } from "@/server/auth/session-rules";
import * as s from "@/server/db/schema";
import {
  BASE_URL,
  GOOD_PASSWORD,
  PWNED_PASSWORD,
  cookieHeader,
  createTestAuth,
  linkIn,
  mockPwnedApi,
  totp,
  type TestAuth,
} from "./helpers/test-auth";

// Real Better Auth + all migrations in PGlite, running as app_runtime.
// Fake addresses (example.invalid), fake passwords, HIBP mocked, no network.

let t: TestAuth;
let n = 0;
const fresh = (prefix = "user") => `${prefix}-${++n}@example.invalid`;

beforeAll(async () => {
  t = await createTestAuth();
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  mockPwnedApi();
  t.sent.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function userByEmail(email: string) {
  const [row] = await t.db.select().from(s.user).where(eq(s.user.email, email));
  return row;
}

/** Signs up and clicks the verification link (through the real HTTP handler). */
async function verifiedUser(role: "student" | "teacher" = "student") {
  const email = fresh(role);
  expect(
    await signUpFlow(t.ctx({ "x-forwarded-for": `198.51.100.${n}` }), role, {
      name: "Fake Person",
      email,
      password: GOOD_PASSWORD,
    }),
  ).toBe("check-email");
  const link = linkIn(t.sent.find((m) => m.to === email && m.kind === "verify-email"));
  const res = await t.auth.handler(new Request(link));
  expect(res.status).toBe(302);
  return email;
}

async function signIn(email: string, password = GOOD_PASSWORD, ip = `192.0.2.${++n % 250}`) {
  return signInFlow(t.ctx({ "x-forwarded-for": ip }), { email, password });
}

async function sessionFor(cookies: string[]) {
  return t.auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(cookies) }) });
}

describe("sign-up: role comes from the path, never from input", () => {
  it("student and teacher paths set the role on the server", async () => {
    const student = await verifiedUser("student");
    const teacher = await verifiedUser("teacher");
    expect((await userByEmail(student))?.role).toBe("student");
    expect((await userByEmail(teacher))?.role).toBe("teacher");
  });

  it("a role in the sign-up input is ignored (even calling Better Auth directly)", async () => {
    const viaFlow = fresh();
    await signUpFlow(t.ctx(), "student", {
      name: "X",
      email: viaFlow,
      password: GOOD_PASSWORD,
      role: "admin",
    });
    expect((await userByEmail(viaFlow))?.role).toBe("student");

    const direct = fresh();
    await t.auth.api.signUpEmail({
      body: { name: "X", email: direct, password: GOOD_PASSWORD, role: "admin" } as never,
    });
    expect((await userByEmail(direct))?.role).toBe("student");
  });

  it("a profile update can't set the role", async () => {
    const email = await verifiedUser();
    const signedIn = await signIn(email);
    expect(signedIn.status).toBe("ok");
    const headers = new Headers({
      cookie: cookieHeader((signedIn as { setCookies: string[] }).setCookies),
    });
    await expect(
      t.auth.api.updateUser({ body: { role: "admin" } as never, headers }),
    ).rejects.toThrow(/not allowed/);
    expect((await userByEmail(email))?.role).toBe("student");
  });

  it("the app's database role can never create or promote an admin", async () => {
    const email = await verifiedUser();
    await expect(
      t.db.update(s.user).set({ role: "admin" }).where(eq(s.user.email, email)),
    ).rejects.toSatisfy((e: unknown) =>
      /seed script/.test(String((e as { cause?: Error }).cause?.message)),
    );
    await expect(
      t.db.insert(s.user).values({ id: "sneaky", name: "x", email: fresh(), role: "admin" }),
    ).rejects.toThrow();
  });
});

describe("passwords", () => {
  it("min 12 characters", async () => {
    expect(
      await signUpFlow(t.ctx(), "student", { name: "X", email: fresh(), password: "Short-Pw-11" }),
    ).toBe("too-short");
  });

  it("breached passwords are refused (Have I Been Pwned)", async () => {
    expect(
      await signUpFlow(t.ctx(), "student", { name: "X", email: fresh(), password: PWNED_PASSWORD }),
    ).toBe("compromised");
  });

  it("fails closed when Have I Been Pwned is unreachable, and logs no password or hash", async () => {
    vi.unstubAllGlobals();
    mockPwnedApi("down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const email = fresh();
    expect(
      await signUpFlow(t.ctx(), "student", { name: "X", email, password: GOOD_PASSWORD }),
    ).toBe("check-unavailable");
    expect(await userByEmail(email)).toBeUndefined();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/fail closed/);
    expect(logged).not.toContain(GOOD_PASSWORD);
    expect(logged).not.toMatch(/[0-9A-F]{40}|[0-9A-F]{35}/i);
  });
});

describe("no account enumeration", () => {
  it("sign-up answers the same for a new and an existing email", async () => {
    const existing = await verifiedUser();
    const again = await signUpFlow(t.ctx(), "teacher", {
      name: "Y",
      email: existing,
      password: GOOD_PASSWORD,
    });
    expect(again).toBe("check-email");
    // The existing (verified) user gets a notice instead; role unchanged.
    expect(t.sent.some((m) => m.to === existing && m.kind === "account-exists")).toBe(true);
    expect((await userByEmail(existing))?.role).toBe("student");
  });

  it("sign-in gives the same result for wrong password, unknown and unverified email", async () => {
    const verified = await verifiedUser();
    const unverified = fresh();
    await signUpFlow(t.ctx(), "student", { name: "U", email: unverified, password: GOOD_PASSWORD });
    const results = [
      await signIn(verified, "Wrong-Passw0rd-Totally"),
      await signIn(fresh("nobody")),
      await signIn(unverified),
    ];
    expect(results).toEqual([{ status: "invalid" }, { status: "invalid" }, { status: "invalid" }]);
  });

  it("password reset answers the same for known and unknown emails", async () => {
    const known = await verifiedUser();
    t.sent.length = 0;
    expect(await requestResetFlow(t.ctx(), { email: known })).toBe("sent");
    expect(await requestResetFlow(t.ctx(), { email: fresh("nobody") })).toBe("sent");
    expect(t.sent.map((m) => m.kind)).toEqual(["reset-password"]);
  });

  it("'account exists' notices are limited per recipient (no inbox flooding)", async () => {
    const victim = await verifiedUser();
    t.sent.length = 0;
    for (let i = 0; i < 5; i++) {
      await signUpFlow(t.ctx({ "x-forwarded-for": `198.18.0.${i}` }), "student", {
        name: "Spam",
        email: victim,
        password: GOOD_PASSWORD,
      });
    }
    expect(t.sent.filter((m) => m.to === victim).length).toBe(2);
  });
});

describe("email links", () => {
  it("are built from the configured base URL, not the Host header", async () => {
    const email = fresh();
    await signUpFlow(
      t.ctx({ host: "evil.example", "x-forwarded-host": "evil.example" }),
      "student",
      {
        name: "X",
        email,
        password: GOOD_PASSWORD,
      },
    );
    const link = linkIn(t.sent.find((m) => m.to === email));
    expect(link.startsWith(`${BASE_URL}/api/auth/verify-email?`)).toBe(true);
  });

  it("verification links expire after 24 hours; reset links after 15 minutes", async () => {
    expect(VERIFY_TOKEN_SECONDS).toBe(24 * 3600);
    expect(RESET_TOKEN_SECONDS).toBe(15 * 60);
    const email = await verifiedUser();
    await requestResetFlow(t.ctx(), { email });
    const rows = await t.db.select().from(s.verification);
    const newest = rows.sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
    const lifetime = (+newest.expiresAt - +newest.createdAt) / 1000;
    expect(Math.abs(lifetime - RESET_TOKEN_SECONDS)).toBeLessThan(5);
  });
});

describe("password reset and change revoke sessions", () => {
  it("reset works once, revokes every session, and the link can't be reused", async () => {
    const email = await verifiedUser();
    const a = await signIn(email);
    const b = await signIn(email);
    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    await requestResetFlow(t.ctx(), { email });
    const link = linkIn(t.sent.find((m) => m.to === email && m.kind === "reset-password"));
    expect(link.startsWith(`${BASE_URL}/api/auth/reset-password/`)).toBe(true);
    const token = new URL(link).pathname.split("/").at(-1)!;
    const newPassword = "Another-Fake-Passw0rd-Long";
    expect(await resetPasswordFlow(t.ctx(), { token, password: newPassword })).toBe("ok");
    const user = await userByEmail(email);
    expect(await t.db.select().from(s.session).where(eq(s.session.userId, user!.id))).toHaveLength(
      0,
    );
    expect(await resetPasswordFlow(t.ctx(), { token, password: "Yet-Another-Fake-Pw-1" })).toBe(
      "invalid-link",
    );
    expect((await signIn(email, newPassword)).status).toBe("ok");
  });

  it("an expired reset link is refused", async () => {
    const email = await verifiedUser();
    await requestResetFlow(t.ctx(), { email });
    const link = linkIn(t.sent.find((m) => m.to === email && m.kind === "reset-password"));
    const token = new URL(link).pathname.split("/").at(-1)!;
    await t.db.update(s.verification).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(
      await resetPasswordFlow(t.ctx(), { token, password: "Another-Fake-Passw0rd-Long" }),
    ).toBe("invalid-link");
  });

  it("changing the password revokes all OTHER sessions", async () => {
    const email = await verifiedUser();
    const a = (await signIn(email)) as { status: "ok"; setCookies: string[] };
    await signIn(email);
    await signIn(email);
    const me = await sessionFor(a.setCookies);
    const session = { userId: me!.user.id, role: "student" as const, mfaVerified: false };
    expect(
      await changePasswordFlow(
        { ...t.ctx(), headers: new Headers({ cookie: cookieHeader(a.setCookies) }) },
        session,
        { current: GOOD_PASSWORD, next: "Changed-Fake-Passw0rd-Long" },
      ),
    ).toBe("ok");
    const left = await t.db.select().from(s.session).where(eq(s.session.userId, me!.user.id));
    expect(left).toHaveLength(1);
  });
});

describe("rate limits use only the proxy-added client address", () => {
  it("a spoofed X-Forwarded-For prefix doesn't change the per-IP key", async () => {
    const realIp = "203.0.113.99";
    const results = [];
    for (let i = 0; i < 21; i++) {
      results.push(
        await signInFlow(t.ctx({ "x-forwarded-for": `10.0.${i}.1, 172.16.${i}.9, ${realIp}` }), {
          email: fresh("nobody"),
          password: "Whatever-Passw0rd-12",
        }),
      );
    }
    expect(results.slice(0, 20).every((r) => r.status === "invalid")).toBe(true);
    expect(results[20]).toEqual({ status: "rate-limited" });
  });

  it("per-email sign-in limit applies across different IPs", async () => {
    const email = await verifiedUser();
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await signIn(email, "Wrong-Passw0rd-Totally", `198.51.100.${200 + i}`)).status,
      );
    }
    expect(statuses).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "rate-limited",
    ]);
  });
});

describe("cookies", () => {
  it("session cookie is __Secure-, HttpOnly, Secure and SameSite=Lax (https base URL)", async () => {
    const email = await verifiedUser();
    const result = (await signIn(email)) as { setCookies: string[] };
    const cookie = result.setCookies.find((c) =>
      c.startsWith("__Secure-better-auth.session_token="),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe("admins: 2FA required, 12-hour absolute sessions", () => {
  it("full flow: no 2FA -> mfaVerified false; enabling signs out everywhere; 2FA sign-in -> mfaVerified true", async () => {
    const email = await verifiedUser();
    await t.asOwner(() =>
      t.db.update(s.user).set({ role: "admin" }).where(eq(s.user.email, email)),
    );

    const first = (await signIn(email)) as { status: string; setCookies: string[] };
    expect(first.status).toBe("ok");
    const before = evaluateSession(await sessionFor(first.setCookies));
    expect(before).toMatchObject({ kind: "ok", session: { role: "admin", mfaVerified: false } });

    const headers = new Headers({ cookie: cookieHeader(first.setCookies) });
    if (before.kind !== "ok") throw new Error("expected a session");
    const adminSession = before.session;
    const setup = await startTwoFactorSetupFlow({ ...t.ctx(), headers }, adminSession, {
      password: GOOD_PASSWORD,
    });
    expect(setup.status).toBe("ok");
    const { secret, backupCodes } = setup as { secret: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(0);

    // Stored encrypted: neither the secret nor a backup code appears in the row.
    const [stored] = await t.db.select().from(s.twoFactor);
    expect(stored!.secret).not.toContain(secret);
    expect(stored!.backupCodes).not.toContain(backupCodes[0]!);

    expect(
      await confirmTwoFactorSetupFlow({ ...t.ctx(), headers }, adminSession, {
        code: totp(secret),
      }),
    ).toBe("ok");
    const user = await userByEmail(email);
    expect(user?.twoFactorEnabled).toBe(true);
    expect(await t.db.select().from(s.session).where(eq(s.session.userId, user!.id))).toHaveLength(
      0,
    );

    const second = (await signIn(email)) as { status: string; setCookies: string[] };
    expect(second.status).toBe("two-factor");
    const verified = await verifyTwoFactorFlow(
      { ...t.ctx(), headers: new Headers({ cookie: cookieHeader(second.setCookies) }) },
      { kind: "totp", code: totp(secret) },
    );
    expect(verified.status).toBe("ok");
    const after = await sessionFor((verified as { setCookies: string[] }).setCookies);
    expect(evaluateSession(after)).toMatchObject({
      kind: "ok",
      session: { role: "admin", mfaVerified: true },
    });
    const lifetime =
      (+new Date(after!.session.expiresAt) - +new Date(after!.session.createdAt)) / 1000;
    expect(Math.abs(lifetime - ADMIN_SESSION_SECONDS)).toBeLessThan(5);
  });

  it("an admin session older than 12 hours is rejected even if not expired", () => {
    const created = new Date(Date.now() - ADMIN_SESSION_SECONDS * 1000 - 1000);
    expect(
      evaluateSession({
        session: { id: "s1", createdAt: created },
        user: { id: "a", role: "admin", twoFactorEnabled: true },
      }),
    ).toEqual({ kind: "expired-admin", sessionId: "s1" });
  });

  it("students and teachers get 7-day sessions; unknown roles get none", async () => {
    const email = await verifiedUser("teacher");
    const result = (await signIn(email)) as { setCookies: string[] };
    const sess = await sessionFor(result.setCookies);
    const days =
      (+new Date(sess!.session.expiresAt) - +new Date(sess!.session.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect(
      evaluateSession({
        session: { id: "x", createdAt: new Date() },
        user: { id: "u", role: "root" },
      }),
    ).toEqual({ kind: "none" });
  });
});
