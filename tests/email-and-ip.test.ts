import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientIp } from "@/server/auth/client-ip";
import { consoleTransport, emails, resendTransport, sendInBackground } from "@/server/auth/email";

const LINK = "https://app.example.invalid/api/auth/verify-email?token=FAKE-TOKEN-123";
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email transports", () => {
  it("resend mode logs only the kind – never the address, token or link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sendInBackground(
      resendTransport("re_FakeKey", "onboarding@resend.dev"),
      emails.verifyEmail("someone@example.invalid", LINK),
    );
    await flush();
    const output = [...info.mock.calls, ...log.mock.calls].flat().join(" ");
    expect(output).toBe("email sent: verify-email");
  });

  it("resend failures log the kind and status only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret details", { status: 403 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendInBackground(
      resendTransport("re_FakeKey", "onboarding@resend.dev"),
      emails.resetPassword("someone@example.invalid", LINK),
    );
    await flush();
    await flush();
    expect(warn.mock.calls.flat().join(" ")).toBe(
      "email failed: reset-password (Resend responded 403)",
    );
  });

  it("resend sends the display name from code and the bare address from env", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await resendTransport("re_FakeKey", "onboarding@resend.dev").send(
      emails.verifyEmail("someone@example.invalid", LINK),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.from).toBe('"Skóli lífsins" <onboarding@resend.dev>');
    expect(body.to).toEqual(["someone@example.invalid"]);
  });

  it("console mode prints the whole email including the link (local dev only)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleTransport().send(emails.verifyEmail("someone@example.invalid", LINK));
    expect(log.mock.calls.flat().join(" ")).toContain(LINK);
    expect(log.mock.calls.flat().join(" ")).toContain("not sent");
  });
});

describe("getClientIp: only the proxy-added address counts", () => {
  const ip = (xff?: string) => getClientIp(new Headers(xff ? { "x-forwarded-for": xff } : {}));
  it("takes the last entry (added by nginx), ignoring client-supplied ones", () => {
    expect(ip("203.0.113.7")).toBe("203.0.113.7");
    expect(ip("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
    expect(ip("evil, 9.9.9.9 , 203.0.113.7")).toBe("203.0.113.7");
    expect(ip("2001:db8::1")).toBe("2001:db8::1");
  });
  it("falls back to a shared 'unknown' bucket for missing or garbage values", () => {
    expect(ip()).toBe("unknown");
    expect(ip("203.0.113.7, not-an-ip")).toBe("unknown");
    expect(ip("")).toBe("unknown");
  });
});
