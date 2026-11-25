import type { Instrumentation } from "next";

/**
 * Runs once when the Next.js server starts (not during `next build`).
 * 1. Sanitizes console.error/console.warn, so nothing (including Next.js's
 *    own error output) can print SQL, parameter values, emails or tokens.
 * 2. Validates the server environment so a missing or invalid variable stops
 *    the container at boot instead of failing later on a user request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installConsoleSanitizer } = await import("./server/log/safe-log");
    installConsoleSanitizer();
    await import("./server/validate-env-on-startup");
  }
}

/** Errors that escape our handlers: logged as one sanitized line, never in full. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logSafeError } = await import("./server/log/safe-log");
  const requestId = request.headers["x-request-id"];
  logSafeError(
    `${context.routeType}:${context.routePath}`,
    error,
    typeof requestId === "string" ? requestId : undefined,
  );
};
