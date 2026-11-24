"use server";

import { redirect } from "next/navigation";
import { flowContext, requireUser } from "@/server/auth";
import {
  changePasswordFlow,
  confirmTwoFactorSetupFlow,
  requestResetFlow,
  resetPasswordFlow,
  signInFlow,
  signOutFlow,
  signUpFlow,
  startTwoFactorSetupFlow,
  verifyTwoFactorFlow,
  type StartTwoFactorResult,
} from "@/server/auth/flows";

/**
 * Auth server actions. Thin wrappers: all logic, validation and rate limiting
 * is in src/server/auth/flows.ts. Results are passed to pages only as fixed
 * codes in the URL (never reflected text). Public actions are listed in
 * src/server/auth/public-routes.ts; all others call requireUser().
 * Cookies are set by Better Auth's nextCookies() plugin.
 */

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// ---- public ----------------------------------------------------------------

export async function signInAction(form: FormData) {
  const result = await signInFlow(await flowContext(), {
    email: field(form, "email"),
    password: field(form, "password"),
  });
  if (result.status === "ok") redirect("/heim");
  if (result.status === "two-factor") redirect("/tveggja-thatta");
  redirect(`/innskraning?villa=${result.status}`);
}

async function signUp(role: "student" | "teacher", path: string, form: FormData) {
  const result = await signUpFlow(await flowContext(), role, {
    name: field(form, "name"),
    email: field(form, "email"),
    password: field(form, "password"),
  });
  redirect(`${path}?stada=${result}`);
}

export async function signUpStudentAction(form: FormData) {
  await signUp("student", "/nyskraning/nemandi", form);
}

export async function signUpTeacherAction(form: FormData) {
  await signUp("teacher", "/nyskraning/kennari", form);
}

export async function requestResetAction(form: FormData) {
  const result = await requestResetFlow(await flowContext(), { email: field(form, "email") });
  redirect(`/gleymt-lykilord?stada=${result}`);
}

export async function resetPasswordAction(form: FormData) {
  const token = field(form, "token");
  const result = await resetPasswordFlow(await flowContext(), {
    token,
    password: field(form, "password"),
  });
  if (result === "ok") redirect("/innskraning?stada=nytt-lykilord");
  const tokenParam = /^[A-Za-z0-9_-]{1,256}$/.test(token) ? `&token=${token}` : "";
  redirect(`/endurstilla-lykilord?villa=${result}${tokenParam}`);
}

export async function verifyTwoFactorAction(form: FormData) {
  const kind = field(form, "kind") === "backup" ? "backup" : "totp";
  const result = await verifyTwoFactorFlow(await flowContext(), {
    kind,
    code: field(form, "code").replace(/\s+/g, ""),
  });
  if (result.status === "ok") redirect("/heim");
  redirect(`/tveggja-thatta?villa=${result.status}`);
}

export async function signOutAction() {
  await signOutFlow(await flowContext());
  redirect("/innskraning?stada=utskrad");
}

// ---- protected (requireUser) -------------------------------------------------

export async function changePasswordAction(form: FormData) {
  const session = await requireUser();
  const result = await changePasswordFlow(await flowContext(), session, {
    current: field(form, "current"),
    next: field(form, "next"),
  });
  redirect(`/stillingar?stada=${result}`);
}

export type TwoFactorSetupState = { step: "start" } | StartTwoFactorResult;

/** Step 1 of TOTP setup. Returns the secret and backup codes to show ONCE. */
export async function startTwoFactorSetupAction(
  _previous: TwoFactorSetupState,
  form: FormData,
): Promise<TwoFactorSetupState> {
  const session = await requireUser({ allowAdminWithoutMfa: true });
  return startTwoFactorSetupFlow(await flowContext(), session, {
    password: field(form, "password"),
  });
}

/** Step 2: confirm with a code. Signs out everywhere; sign in again with 2FA. */
export async function confirmTwoFactorSetupAction(form: FormData) {
  const session = await requireUser({ allowAdminWithoutMfa: true });
  const result = await confirmTwoFactorSetupFlow(await flowContext(), session, {
    code: field(form, "code").replace(/\s+/g, ""),
  });
  if (result === "ok") redirect("/innskraning?stada=2fa-virkt");
  redirect(`/stillingar/tveggja-thatta?villa=${result}`);
}
