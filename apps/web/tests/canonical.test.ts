import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, jobIdOf, sha256Hex } from "@/lib/canonical";

const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "..", "database", "fixtures", "job_ids.json"), "utf8"),
);

describe("canonical JSON and job ids", () => {
  it("matches the shared fixtures that the C++ engine also verifies", () => {
    for (const c of fixtures.cases) {
      expect(canonicalJson(c.definition)).toBe(c.canonical);
      expect(jobIdOf(c.definition)).toBe(c.job_id);
    }
  });

  it("is independent of key order (property test)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const build = (depth: number): unknown => {
      if (depth === 0 || rnd() < 0.2)
        return rnd() < 0.5 ? Math.floor(rnd() * 1000) - 500 : "s" + Math.floor(rnd() * 99);
      if (rnd() < 0.3) return Array.from({ length: Math.floor(rnd() * 4) }, () => build(depth - 1));
      const keys = ["a", "b", "c", "d", "e"].filter(() => rnd() < 0.7);
      return Object.fromEntries(keys.map((k) => [k, build(depth - 1)]));
    };
    const shuffle = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(shuffle);
      if (v && typeof v === "object") {
        const entries = Object.entries(v as object).map(([k, x]) => [k, shuffle(x)] as const);
        return Object.fromEntries(entries.sort(() => rnd() - 0.5));
      }
      return v;
    };
    for (let i = 0; i < 300; i++) {
      const v = build(4);
      expect(canonicalJson(shuffle(v))).toBe(canonicalJson(v));
    }
  });

  it("rejects values that cannot be hashed identically in every language", () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow();
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: 2 ** 60 })).toThrow();
    expect(() => canonicalJson({ x: () => 1 })).toThrow();
  });

  it("distinguishes any change to the definition", () => {
    const base = fixtures.cases[0].definition;
    expect(jobIdOf({ ...base, solver_version: "nqueens-bitmask-prefix/2" })).not.toBe(jobIdOf(base));
    expect(jobIdOf({ ...base, partition: { prefix: [1] } })).not.toBe(jobIdOf(base));
  });

  it("computes standard SHA-256 vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
