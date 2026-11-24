import type { Role, Session } from "../dal/session";
import { ADMIN_SESSION_SECONDS } from "./create-auth";

/**
 * Turns Better Auth's session result into the DAL Session, applying our rules:
 * - Admin sessions are valid for 12 hours from creation, absolutely
 *   (checked here as well as in the session.create hook).
 * - mfaVerified = the user has 2FA enabled. Sound because (a) with 2FA on,
 *   Better Auth creates a session only after the second factor, (b) we never
 *   pass trustDevice, (c) enabling 2FA deletes all existing sessions, and
 *   (d) email/password is the only sign-in method.
 */
export type AuthSessionResult = {
  session: { id: string; createdAt: Date | string };
  user: { id: string; role?: string | null; twoFactorEnabled?: boolean | null };
} | null;

export type SessionEvaluation =
  | { kind: "none" }
  | { kind: "expired-admin"; sessionId: string }
  | { kind: "ok"; session: Session };

const ROLES: readonly Role[] = ["student", "teacher", "admin"];

export function evaluateSession(result: AuthSessionResult, now = Date.now()): SessionEvaluation {
  if (!result) return { kind: "none" };
  const role = result.user.role as Role;
  if (!ROLES.includes(role)) return { kind: "none" };
  if (role === "admin") {
    const created = new Date(result.session.createdAt).getTime();
    if (!(now - created < ADMIN_SESSION_SECONDS * 1000)) {
      return { kind: "expired-admin", sessionId: result.session.id };
    }
  }
  return {
    kind: "ok",
    session: { userId: result.user.id, role, mfaVerified: result.user.twoFactorEnabled === true },
  };
}
