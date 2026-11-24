import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedAuthRequest } from "@/server/auth/http-allowlist";
import { PUBLIC_ACTIONS, PUBLIC_ROUTES, isPublicPath } from "@/server/auth/public-routes";

// Static check over the source: every page and route handler outside the
// public allow-list, and every server action outside PUBLIC_ACTIONS, must call
// requireUser()/requireRole(). Adding a route without a guard fails here.

const SRC = path.resolve(import.meta.dirname, "../src");
const APP = path.join(SRC, "app");
const GUARD = /\brequire(User|Role)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** "src/app/(auth)/innskraning/page.tsx" -> "/innskraning" */
function routeOf(file: string): string {
  const segments = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`;
}

const files = walk(SRC);
const routeFiles = files.filter((f) => /[/\\](page\.tsx|route\.ts)$/.test(f) && f.startsWith(APP));
const actionFiles = files.filter(
  (f) => /\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")),
);

describe("deny by default", () => {
  it("found the app's routes and actions (sanity check)", () => {
    expect(routeFiles.length).toBeGreaterThan(5);
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles.map((f) => [routeOf(f), path.relative(SRC, f)] as const))(
    "%s (%s) is public or guarded",
    (route, file) => {
      const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(route);
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(isPublic || GUARD.test(source), `${file} must call requireUser()/requireRole()`).toBe(
        true,
      );
    },
  );

  it("every public route in the allow-list exists (no stale entries)", () => {
    const routes = new Set(routeFiles.map(routeOf));
    for (const route of PUBLIC_ROUTES) expect(routes.has(route), route).toBe(true);
  });

  it("every server action is public-listed or calls the guard", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of actionFiles) {
      const source = readFileSync(file, "utf8");
      // Split into exported functions; each chunk runs to the next export.
      const chunks = source.split(/(?=^export async function )/m).slice(1);
      for (const chunk of chunks) {
        const name = /^export async function (\w+)/.exec(chunk)?.[1] ?? "?";
        seen.add(name);
        const isPublic = (PUBLIC_ACTIONS as readonly string[]).includes(name);
        if (!isPublic && !GUARD.test(chunk)) problems.push(`${path.relative(SRC, file)}: ${name}`);
      }
      // No non-async exports that could slip past this check.
      if (/^export (const|let|function) /m.test(source.replace(/^export type .*$/gm, ""))) {
        problems.push(`${path.relative(SRC, file)}: non-async export in a "use server" file`);
      }
    }
    for (const name of PUBLIC_ACTIONS)
      if (!seen.has(name)) problems.push(`stale PUBLIC_ACTIONS: ${name}`);
    expect(problems).toEqual([]);
  });

  it("protected pages are not public paths for the proxy", () => {
    expect(isPublicPath("/heim")).toBe(false);
    expect(isPublicPath("/stillingar/tveggja-thatta")).toBe(false);
    expect(isPublicPath("/innskraning")).toBe(true);
    expect(isPublicPath("/api/auth/verify-email")).toBe(true);
  });
});

describe("Better Auth HTTP surface: only the email links", () => {
  it.each([
    ["GET", "/api/auth/verify-email"],
    ["GET", "/api/auth/reset-password/AbC_123-xyz"],
  ])("allows %s %s", (method, p) => {
    expect(isAllowedAuthRequest(method, p)).toBe(true);
  });

  it.each([
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/two-factor/verify-totp"],
    ["POST", "/api/auth/request-password-reset"],
    ["POST", "/api/auth/verify-email"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/auth/list-sessions"],
    ["GET", "/api/auth/ok"],
    ["GET", "/api/auth/reset-password/../../x"],
    ["GET", "/api/auth/verify-email/extra"],
  ])("blocks %s %s", (method, p) => {
    expect(isAllowedAuthRequest(method, p)).toBe(false);
  });
});
