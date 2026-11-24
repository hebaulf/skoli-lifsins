// Liveness check for the Docker HEALTHCHECK and Dokku deploy checks.
// Public on purpose; returns nothing about the app's internals or config.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
