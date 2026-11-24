import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECRET_ENV_KEYS, envSchema } from "@/server/env";

// Checks the committed env.1password file against the Zod schema. Needs no
// secrets and never calls the 1Password CLI: it only reads the file's text.

const VAULT_PREFIX = "op://skoli-lifsins/";

type Entry = { key: string; value: string; active: boolean };

function readEntries(): Entry[] {
  const file = readFileSync(path.resolve(import.meta.dirname, "../env.1password"), "utf8");
  const entries: Entry[] = [];
  for (const line of file.split("\n")) {
    // Active "KEY=value" or commented-out "# KEY=value" (a later phase).
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) {
      entries.push({ key: match[2]!, value: match[3]!.trim(), active: match[1] === undefined });
    }
  }
  return entries;
}

const entries = readEntries();
const schemaKeys = Object.keys(envSchema.shape).filter((key) => key !== "NODE_ENV");
const requiredKeys = schemaKeys.filter(
  (key) => !envSchema.shape[key as keyof typeof envSchema.shape].safeParse(undefined).success,
);
const secretKeys: readonly string[] = SECRET_ENV_KEYS;

describe("env.1password", () => {
  it("lists every variable in the env schema exactly once, and nothing else", () => {
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...schemaKeys].sort());
  });

  it("has every required variable active (not commented out)", () => {
    const active = entries.filter((e) => e.active).map((e) => e.key);
    for (const key of requiredKeys) expect(active).toContain(key);
  });

  it("uses an op:// reference into the project vault for every secret", () => {
    for (const key of secretKeys) {
      const entry = entries.find((e) => e.key === key);
      expect(entry, `${key} missing`).toBeDefined();
      expect(entry!.value.startsWith(VAULT_PREFIX), `${key} must be an op:// reference`).toBe(true);
    }
  });

  it("only uses op:// references for variables marked as secrets", () => {
    for (const entry of entries.filter((e) => e.value.startsWith("op://"))) {
      expect(secretKeys, `${entry.key} is an op:// reference but not in SECRET_ENV_KEYS`).toContain(
        entry.key,
      );
    }
  });

  it("uses development references, never demo ones", () => {
    for (const entry of entries.filter((e) => e.value.startsWith("op://"))) {
      expect(entry.value, entry.key).toMatch(/\/dev-[a-z0-9-]+$/);
    }
  });

  it("declares secrets only for keys that exist in the schema", () => {
    for (const key of secretKeys) expect(schemaKeys).toContain(key);
  });
});
