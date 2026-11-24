import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../dal/dal";
import type { Session } from "../dal/session";
import * as schema from "../db/schema";
import { getClientIp } from "./client-ip";
import { AUTH_PATHS, signUpRole, type Auth } from "./create-auth";
import { consumeRateLimits, normaliseEmail, type LimitRule } from "./rate-limit";

/**
 * Auth flows behind the server actions. Every flow:
 * - validates input with Zod,
 * - applies our rate limits (per IP from the proxy-added address, and per
 *   email/user where relevant),
 * - returns a fixed result code; failures never reveal whether an account
 *   exists (sign-up, sign-in and reset look the same either way),
 * - passes only constant redirect targets to Better Auth.
 */
export type FlowContext = { auth: Auth; db: Db; secret: string; headers: Headers };

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const emailSchema = z.email().max(254);
const passwordInput = z.string().min(1).max(512);

// ---- helpers ---------------------------------------------------------------

const MIN = 60;
const HOUR = 3600;

async function limited(ctx: FlowContext, rules: LimitRule[]): Promise<boolean> {
  return !(await consumeRateLimits(ctx.db, ctx.secret, rules));
}

const ipRule = (ctx: FlowContext, scope: string, limit: number, windowSeconds: number) => ({
  scope: `${scope}:ip`,
  value: getClientIp(ctx.headers),
  limit,
  windowSeconds,
});

export type PasswordProblem = "too-short" | "too-long" | "compromised" | "check-unavailable";

/**
 * Password policy, checked BEFORE calling Better Auth so the outcome doesn't
 * depend on whether the email exists. Have I Been Pwned failures fail closed.
 */
export async function passwordProblem(password: string): Promise<PasswordProblem | null> {
  if (password.length < PASSWORD_MIN) return "too-short";
  if (password.length > PASSWORD_MAX) return "too-long";
  try {
    if (await isPasswordCompromised(password)) return "compromised";
  } catch {
    // Never log the password or its hash.
    console.warn("Have I Been Pwned check failed; refusing the password (fail closed).");
    return "check-unavailable";
  }
  return null;
}

function setCookiesOf(headers: Headers | undefined | null): string[] {
  return headers?.getSetCookie?.() ?? [];
}

// ---- sign-up ---------------------------------------------------------------

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordInput,
});

export type SignUpResult =
  "check-email" | "invalid-input" | "rate-limited" | PasswordProblem | "error";

export async function signUpFlow(
  ctx: FlowContext,
  role: "student" | "teacher",
  raw: unknown,
): Promise<SignUpResult> {
  const input = signUpSchema.safeParse(raw);
  if (!input.success) return "invalid-input";
  if (await limited(ctx, [ipRule(ctx, "sign-up", 3, HOUR)])) return "rate-limited";
  const problem = await passwordProblem(input.data.password);
  if (problem) return problem;
  try {
    // The role comes from the PATH (this argument), never from the request.
    await signUpRole.run(role, () =>
      ctx.auth.api.signUpEmail({
        body: {
          name: input.data.name,
          email: input.data.email,
          password: input.data.password,
          callbackURL: AUTH_PATHS.afterVerify,
        },
        headers: ctx.headers,
      }),
    );
  } catch {
    return "error";
  }
  // Same answer for new and existing emails.
  return "check-email";
}

// ---- sign-in ---------------------------------------------------------------

const signInSchema = z.object({ email: emailSchema, password: passwordInput });

export type SignInResult =
  | { status: "ok"; setCookies: string[] }
  | { status: "two-factor"; setCookies: string[] }
  | { status: "invalid" | "rate-limited" | "error" };

export async function signInFlow(ctx: FlowContext, raw: unknown): Promise<SignInResult> {
  const input = signInSchema.safeParse(raw);
  if (!input.success) return { status: "invalid" };
  const email = normaliseEmail(input.data.email);
  if (
    await limited(ctx, [
      { scope: "sign-in:email", value: email, limit: 5, windowSeconds: 15 * MIN },
      ipRule(ctx, "sign-in", 20, 15 * MIN),
    ])
  ) {
    return { status: "rate-limited" };
  }
  try {
    const { headers, response } = await ctx.auth.api.signInEmail({
      body: { email: input.data.email, password: input.data.password, rememberMe: true },
      headers: ctx.headers,
      returnHeaders: true,
    });
    const twoFactor = (response as { twoFactorRedirect?: boolean }).twoFactorRedirect === true;
    return { status: twoFactor ? "two-factor" : "ok", setCookies: setCookiesOf(headers) };
  } catch {
    // Wrong password, unknown email and unverified email all end up here.
    return { status: "invalid" };
  }
}

// ---- password reset --------------------------------------------------------

export type RequestResetResult = "sent" | "invalid-input" | "rate-limited";

export async function requestResetFlow(
  ctx: FlowContext,
  raw: unknown,
): Promise<RequestResetResult> {
  const input = z.object({ email: emailSchema }).safeParse(raw);
  if (!input.success) return "invalid-input";
  const email = normaliseEmail(input.data.email);
  if (
    await limited(ctx, [
      { scope: "reset-request:email", value: email, limit: 3, windowSeconds: HOUR },
      ipRule(ctx, "reset-request", 10, HOUR),
    ])
  ) {
    return "rate-limited";
  }
  try {
    await ctx.auth.api.requestPasswordReset({
      body: { email: input.data.email, redirectTo: AUTH_PATHS.resetForm },
      headers: ctx.headers,
    });
  } catch {
    // Same answer either way.
  }
  return "sent";
}

export type ResetPasswordResult = "ok" | "invalid-link" | "rate-limited" | PasswordProblem;

export async function resetPasswordFlow(
  ctx: FlowContext,
  raw: unknown,
): Promise<ResetPasswordResult> {
  const input = z
    .object({ token: z.string().min(1).max(512), password: passwordInput })
    .safeParse(raw);
  if (!input.success) return "invalid-link";
  if (await limited(ctx, [ipRule(ctx, "reset", 10, HOUR)])) return "rate-limited";
  const problem = await passwordProblem(input.data.password);
  if (problem) return problem;
  try {
    // Single use; revokeSessionsOnPasswordReset signs out every session.
    await ctx.auth.api.resetPassword({
      body: { token: input.data.token, newPassword: input.data.password },
      headers: ctx.headers,
    });
    return "ok";
  } catch {
    return "invalid-link";
  }
}

export type ChangePasswordResult = "ok" | "invalid" | "rate-limited" | PasswordProblem;

export async function changePasswordFlow(
  ctx: FlowContext,
  session: Session,
  raw: unknown,
): Promise<ChangePasswordResult> {
  const input = z.object({ current: passwordInput, next: passwordInput }).safeParse(raw);
  if (!input.success) return "invalid";
  if (
    await limited(ctx, [
      { scope: "change-password:user", value: session.userId, limit: 5, windowSeconds: 15 * MIN },
    ])
  ) {
    return "rate-limited";
  }
  const problem = await passwordProblem(input.data.next);
  if (problem) return problem;
  try {
    await ctx.auth.api.changePassword({
      body: {
        currentPassword: input.data.current,
        newPassword: input.data.next,
        revokeOtherSessions: true,
      },
      headers: ctx.headers,
    });
    return "ok";
  } catch {
    return "invalid";
  }
}

// ---- two-factor ------------------------------------------------------------

export type VerifyTwoFactorResult =
  { status: "ok"; setCookies: string[] } | { status: "invalid" | "rate-limited" };

/** Second step of sign-in. Never trusts the device (no 30-day skip). */
export async function verifyTwoFactorFlow(
  ctx: FlowContext,
  raw: unknown,
): Promise<VerifyTwoFactorResult> {
  const input = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("totp"), code: z.string().regex(/^\d{6}$/) }),
      z.object({
        kind: z.literal("backup"),
        code: z.string().regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/),
      }),
    ])
    .safeParse(raw);
  if (!input.success) return { status: "invalid" };
  if (await limited(ctx, [ipRule(ctx, "two-factor", 10, 15 * MIN)]))
    return { status: "rate-limited" };
  try {
    const body = { code: input.data.code, trustDevice: false };
    const { headers } =
      input.data.kind === "totp"
        ? await ctx.auth.api.verifyTOTP({ body, headers: ctx.headers, returnHeaders: true })
        : await ctx.auth.api.verifyBackupCode({ body, headers: ctx.headers, returnHeaders: true });
    return { status: "ok", setCookies: setCookiesOf(headers) };
  } catch {
    return { status: "invalid" };
  }
}

export type StartTwoFactorResult =
  | { status: "ok"; secret: string; totpURI: string; backupCodes: string[] }
  | { status: "invalid" | "rate-limited" };

/** Starts TOTP setup (password required). Shows secret + backup codes once. */
export async function startTwoFactorSetupFlow(
  ctx: FlowContext,
  session: Session,
  raw: unknown,
): Promise<StartTwoFactorResult> {
  const input = z.object({ password: passwordInput }).safeParse(raw);
  if (!input.success) return { status: "invalid" };
  if (
    await limited(ctx, [
      { scope: "two-factor-setup:user", value: session.userId, limit: 5, windowSeconds: 15 * MIN },
    ])
  ) {
    return { status: "rate-limited" };
  }
  try {
    const result = await ctx.auth.api.enableTwoFactor({
      body: { password: input.data.password, method: "totp" },
      headers: ctx.headers,
    });
    if (result.method !== "totp") return { status: "invalid" };
    const secret = new URL(result.totpURI).searchParams.get("secret") ?? "";
    return { status: "ok", secret, totpURI: result.totpURI, backupCodes: result.backupCodes };
  } catch {
    return { status: "invalid" };
  }
}

export type ConfirmTwoFactorResult = "ok" | "invalid" | "rate-limited";

/**
 * Confirms TOTP setup with a first code, then deletes ALL of the user's
 * sessions. Invariant: any session of a user with 2FA enabled was created by a
 * sign-in that passed the second factor (that's what mfaVerified relies on).
 */
export async function confirmTwoFactorSetupFlow(
  ctx: FlowContext,
  session: Session,
  raw: unknown,
): Promise<ConfirmTwoFactorResult> {
  const input = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(raw);
  if (!input.success) return "invalid";
  if (
    await limited(ctx, [
      { scope: "two-factor-setup:user", value: session.userId, limit: 5, windowSeconds: 15 * MIN },
    ])
  ) {
    return "rate-limited";
  }
  try {
    await ctx.auth.api.verifyTOTP({ body: { code: input.data.code }, headers: ctx.headers });
  } catch {
    return "invalid";
  }
  await ctx.db.delete(schema.session).where(eq(schema.session.userId, session.userId));
  return "ok";
}

export async function signOutFlow(ctx: FlowContext): Promise<void> {
  try {
    await ctx.auth.api.signOut({ headers: ctx.headers });
  } catch {
    // Already signed out.
  }
}
