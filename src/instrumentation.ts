/**
 * Runs once when the Next.js server starts (not during `next build`).
 * Validates the server environment so a missing or invalid variable stops the
 * container at boot instead of failing later on a user request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./server/validate-env-on-startup");
  }
}
