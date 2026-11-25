import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import type { Role, Session } from "../dal/session";
import { getEnv } from "../env";
import { getRequestId } from "../log/request-id";
import { AUTH_PATHS, createAuth, type Auth } from "./create-auth";
import { consoleTransport, resendTransport } from "./email";
import type { FlowContext } from "./flows";
import { evaluateSession } from "./session-rules";

/**
 * Server-side auth entry points. Deny by default: every protected page,
 * server action and route handler calls requireUser()/requireRole(); public
 * routes are listed in ./public-routes.ts (enforced by tests/deny-by-default).
 */

let auth: Auth | undefined;

export function getAuth(): Auth {
  if (!auth) {
    const env = getEnv();
    auth = createAuth({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.APP_BASE_URL,
      transport:
        env.EMAIL_TRANSPORT === "console"
          ? consoleTransport()
          : resendTransport(env.RESEND_API_KEY!, env.EMAIL_FROM),
      nextJsCookies: true,
    });
  }
  return auth;
}

export async function flowContext(): Promise<FlowContext> {
  const requestHeaders = await headers();
  return {
    auth: getAuth(),
    db: getDb(),
    secret: getEnv().BETTER_AUTH_SECRET,
    headers: requestHeaders,
    requestId: await getRequestId(),
  };
}

/** The current user's DAL session, or null. Expired admin sessions are deleted. */
export async function getSession(): Promise<Session | null> {
  // Read the request headers FIRST: this marks the page as per-request
  // (never prerendered at build time) before anything touches env or the DB.
  const requestHeaders = await headers();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  const evaluation = evaluateSession(result);
  if (evaluation.kind === "expired-admin") {
    await getDb().delete(schema.session).where(eq(schema.session.id, evaluation.sessionId));
    return null;
  }
  return evaluation.kind === "ok" ? evaluation.session : null;
}

type RequireOptions = { allowAdminWithoutMfa?: boolean };

/**
 * Deny by default. No session: redirect to login. An admin without a
 * completed second factor can only reach the 2FA setup page.
 */
export async function requireUser(options: RequireOptions = {}): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(AUTH_PATHS.login);
  if (session.role === "admin" && !session.mfaVerified && !options.allowAdminWithoutMfa) {
    redirect("/stillingar/tveggja-thatta");
  }
  return session;
}

/** requireUser() plus a role check; other roles get a 404. */
export async function requireRole(roles: readonly Role[], options: RequireOptions = {}) {
  const session = await requireUser(options);
  if (!roles.includes(session.role)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return session;
}
