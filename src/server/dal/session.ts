import "server-only";

/**
 * The verified session every DAL function takes. Built ONLY on the server
 * from the auth library's session (Phase 3), never from client input.
 */
export type Role = "student" | "teacher" | "admin";

export type Session = {
  userId: string;
  role: Role;
  /** True only after a completed second factor in this session (Phase 3). */
  mfaVerified: boolean;
};

/** No (valid) session: pages turn this into a redirect to login. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Not found OR not allowed: deliberately the same error (and a 404), so ids
 * of other people's data can't be probed.
 */
export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

/** Admin-level access without a completed second factor. */
export class MfaRequiredError extends Error {
  constructor() {
    super("Second factor required");
    this.name = "MfaRequiredError";
  }
}

export function requireSession(session: Session | null | undefined): Session {
  if (!session) throw new UnauthenticatedError();
  return session;
}

/**
 * True if the caller may use admin-level access. Every admin-level path goes
 * through here: role admin AND mfaVerified.
 */
export function isVerifiedAdmin(session: Session): boolean {
  if (session.role !== "admin") return false;
  if (!session.mfaVerified) throw new MfaRequiredError();
  return true;
}

export function requireVerifiedAdmin(session: Session): void {
  if (!isVerifiedAdmin(session)) throw new NotFoundError();
}
