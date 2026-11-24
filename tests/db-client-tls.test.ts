import { describe, expect, it } from "vitest";
import { assertVerifiedTls } from "@/server/db/tls";

const base = "postgresql://app_runtime:FakePassw0rd@db.example.invalid/neondb";

describe("assertVerifiedTls (what pg actually does with the URL)", () => {
  it("accepts sslmode=verify-full (certificate and hostname verified)", () => {
    expect(() => assertVerifiedTls(`${base}?sslmode=verify-full`)).not.toThrow();
  });

  it("refuses a URL without TLS", () => {
    expect(() => assertVerifiedTls(base)).toThrow(/not enabled/);
    expect(() => assertVerifiedTls(`${base}?sslmode=disable`)).toThrow(/not enabled/);
  });

  it("refuses modes where pg skips certificate verification", () => {
    expect(() => assertVerifiedTls(`${base}?sslmode=no-verify`)).toThrow(/not enabled/);
    expect(() => assertVerifiedTls(`${base}?uselibpqcompat=true&sslmode=require`)).toThrow(
      /not enabled/,
    );
  });
});
