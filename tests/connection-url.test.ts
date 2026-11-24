import { describe, expect, it } from "vitest";
import { checkConnectionUrl } from "@/server/db/connection-url";

// Fake connection strings only.
const PW = "FakePassw0rdFakePassw0rdFakePassw0rd";
const app = (q = "sslmode=verify-full", user = "app_runtime") =>
  `postgresql://${user}:${PW}@ep-fake-pooler.eu-central-1.aws.neon.tech/neondb?${q}`;

describe("checkConnectionUrl", () => {
  it("accepts the documented app format (pooled host, verify-full, channel_binding)", () => {
    expect(checkConnectionUrl(app("sslmode=verify-full&channel_binding=require"), "app")).toEqual(
      [],
    );
  });

  it.each(["", "sslmode=require", "sslmode=prefer", "sslmode=verify-ca", "sslmode=no-verify"])(
    "rejects anything but sslmode=verify-full (%s)",
    (q) => {
      expect(checkConnectionUrl(app(q), "app")).toContain(
        "must contain sslmode=verify-full exactly once",
      );
    },
  );

  it("rejects a duplicated sslmode (a weaker second value could win)", () => {
    expect(checkConnectionUrl(app("sslmode=verify-full&sslmode=require"), "app")).toContain(
      "must contain sslmode=verify-full exactly once",
    );
  });

  it.each(["uselibpqcompat=true", "ssl=false", "sslrootcert=/tmp/x"])(
    "rejects parameters that can weaken TLS (%s)",
    (extra) => {
      const problems = checkConnectionUrl(app(`sslmode=verify-full&${extra}`), "app");
      expect(problems.some((p) => p.startsWith("must not contain the"))).toBe(true);
    },
  );

  it("app URLs must use the app role; admin URLs must not", () => {
    expect(checkConnectionUrl(app(undefined, "neondb_owner"), "app")).toContain(
      "must connect as app_runtime (the least-privilege app role)",
    );
    expect(checkConnectionUrl(app(undefined, "neondb_owner"), "admin")).toEqual([]);
    expect(checkConnectionUrl(app(), "admin")).toContain(
      "must connect as the owner role, not app_runtime",
    );
  });

  it("rejects non-Postgres URLs, missing password and garbage", () => {
    expect(checkConnectionUrl("mysql://app_runtime:x@h/db?sslmode=verify-full", "app")).toContain(
      "must start with postgresql://",
    );
    expect(
      checkConnectionUrl("postgresql://app_runtime@h/db?sslmode=verify-full", "app"),
    ).toContain("has no password");
    expect(checkConnectionUrl("not a url", "app")).toEqual(["is not a valid URL"]);
  });

  it("never echoes the value in its messages", () => {
    const problems = checkConnectionUrl(app("sslmode=require", "neondb_owner"), "app");
    expect(problems.join(" ")).not.toContain(PW);
    expect(problems.join(" ")).not.toContain("ep-fake");
  });
});
