import { createHash, createHmac } from "node:crypto";
import { vi } from "vitest";
import { createAuth } from "@/server/auth/create-auth";
import type { EmailTransport, OutgoingEmail } from "@/server/auth/email";
import type { FlowContext } from "@/server/auth/flows";
import { createTestDb } from "./test-db";

// Everything here is fake: base URL, secret, addresses, passwords.
export const BASE_URL = "https://app.example.invalid";
export const FAKE_SECRET = "FakeSecretForTestsOnlyFakeSecretForTestsOnly";
export const GOOD_PASSWORD = "Fake-Long-Passw0rd-For-Tests";
export const PWNED_PASSWORD = "Fake-Pwned-Passw0rd-For-Tests";

/** Mocks the Have I Been Pwned range API. "down" = the API is unreachable. */
export function mockPwnedApi(mode: "normal" | "down" = "normal") {
  const sha1 = createHash("sha1").update(PWNED_PASSWORD).digest("hex").toUpperCase();
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("pwnedpasswords.com")) throw new Error(`unexpected fetch: ${url}`);
    if (mode === "down") throw new TypeError("fetch failed");
    const prefix = url.split("/").at(-1);
    const body = prefix === sha1.slice(0, 5) ? `${sha1.slice(5)}:42\r\n` : "";
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export async function createTestAuth() {
  const t = await createTestDb();
  const sent: OutgoingEmail[] = [];
  const transport: EmailTransport = {
    async send(email) {
      sent.push(email);
    },
  };
  const auth = createAuth({
    db: t.db,
    secret: FAKE_SECRET,
    baseURL: BASE_URL,
    transport,
    nextJsCookies: false,
  });
  // Everything from here runs as the app's least-privilege role.
  await t.client.exec("SET ROLE app_runtime");

  /** Runs fn as the owner role (e.g. to create an admin, like the seed script). */
  async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
    await t.client.exec("RESET ROLE");
    try {
      return await fn();
    } finally {
      await t.client.exec("SET ROLE app_runtime");
    }
  }

  // Each call gets its own client IP unless a test sets one, so per-IP
  // limits only interfere where a test is about them.
  let ipCounter = 0;
  const ctx = (headers: Record<string, string> = {}): FlowContext => {
    ipCounter += 1;
    const ip = `100.${(ipCounter >> 8) & 255}.${ipCounter & 255}.1`;
    return {
      auth,
      db: t.db,
      secret: FAKE_SECRET,
      headers: new Headers({ "x-forwarded-for": ip, ...headers }),
    };
  };

  return { ...t, auth, sent, ctx, asOwner };
}

export type TestAuth = Awaited<ReturnType<typeof createTestAuth>>;

/** "name=value; name2=value2" from Set-Cookie headers. */
export function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

/** The link in a captured email (first https URL). */
export function linkIn(email: OutgoingEmail | undefined): string {
  const match = email?.text.match(/https:\/\/\S+/);
  if (!match) throw new Error("no link in email");
  return match[0];
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for a base32 secret. */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}
