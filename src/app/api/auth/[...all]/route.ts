import { getAuth } from "@/server/auth";
import { isAllowedAuthRequest } from "@/server/auth/http-allowlist";

// Public on purpose (listed in src/server/auth/public-routes.ts), but it only
// forwards the email-link endpoints; every other Better Auth path is 404.

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request) {
  if (!isAllowedAuthRequest("GET", new URL(request.url).pathname)) return notFound();
  return getAuth().handler(request);
}

export async function POST() {
  return notFound();
}
