import { describe, expect, it } from "vitest";
import { appPasswordProblems, buildSetAppPasswordStatement } from "@/server/db/app-password";

// Obviously fake passwords, for the rules only.
const OK = "FakeFakeFakeFakeFakeFakeFake1234"; // 32 letters/digits

describe("app role password", () => {
  it("accepts 32+ letters and digits", () => {
    expect(appPasswordProblems(OK)).toEqual([]);
    expect(appPasswordProblems(OK + "abc")).toEqual([]);
  });

  it("rejects missing and short passwords", () => {
    expect(appPasswordProblems(undefined)).toEqual(["APP_DB_PASSWORD is missing"]);
    expect(appPasswordProblems("")).toEqual(["APP_DB_PASSWORD is missing"]);
    expect(appPasswordProblems(OK.slice(0, 31))).toEqual([
      "APP_DB_PASSWORD must be at least 32 characters",
    ]);
  });

  it.each([
    "'; DROP ROLE app_runtime; --",
    "Fake'FakeFakeFakeFakeFakeFakeFake1",
    'FakeFakeFakeFakeFakeFakeFake12"34',
    "FakeFakeFakeFakeFakeFakeFake 1234",
    "FakeFakeFakeFakeFakeFakeFake\\1234",
    "FakeFakeFakeFakeFakeFakeFakeð1234",
    "FakeFakeFakeFakeFakeFakeFake-1234",
  ])("rejects anything but letters and digits: %j", (bad) => {
    expect(appPasswordProblems(bad)).toContain(
      "APP_DB_PASSWORD may contain only letters A–Z, a–z and digits 0–9",
    );
    expect(() => buildSetAppPasswordStatement(bad)).toThrow(/invalid password/);
  });

  it("builds the statement only for a valid password", () => {
    expect(buildSetAppPasswordStatement(OK)).toBe(
      `ALTER ROLE app_runtime WITH LOGIN PASSWORD '${OK}'`,
    );
  });

  it("never puts the value into error messages", () => {
    const bad = "Secret'Secret'Secret'Secret'Secret";
    expect(appPasswordProblems(bad).join(" ")).not.toContain("Secret");
    expect(() => buildSetAppPasswordStatement(bad)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("Secret") }),
    );
  });
});
