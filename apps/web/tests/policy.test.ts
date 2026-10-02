import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide, type PolicySubmission } from "@/lib/policy";

const fixtures = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "..", "..", "database", "fixtures", "verification_cases.json"),
    "utf8",
  ),
);
const sub = (
  worker: string,
  hash: string,
  network: string | null = null,
  trusted = false,
): PolicySubmission => ({ id: worker, workerId: worker, networkHash: network, hash, trusted });

describe("verification policy", () => {
  for (const c of fixtures.cases) {
    it(`conformance: ${c.name}`, () => {
      const verdict = decide(
        c.required,
        c.submissions.map((s: { worker: string; hash: string; trusted: boolean }) =>
          sub(s.worker, s.hash, null, s.trusted),
        ),
        false,
      );
      expect(verdict.status).toBe(c.expect.status);
      expect(verdict.hash).toBe(c.expect.hash);
    });
  }

  it("requires distinct networks when enabled, so one network cannot verify itself", () => {
    const two = [sub("a", "X", "net1"), sub("b", "X", "net1")];
    expect(decide(2, two, true).status).toBe("submitted");
    expect(decide(2, two, false).status).toBe("verified");
    expect(decide(2, [sub("a", "X", "net1"), sub("b", "X", "net2")], true).status).toBe("verified");
  });

  it("never lets one worker count twice", () => {
    expect(decide(2, [sub("a", "X"), sub("a", "X")], false).status).toBe("submitted");
  });

  it("is deterministic regardless of submission order (property test)", () => {
    const hashes = ["X", "Y", "W"];
    let seed = 3;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rnd() * 5);
      const subs = Array.from({ length: n }, (_, k) => sub(`w${k}`, hashes[Math.floor(rnd() * 3)]));
      const a = decide(2, subs, false);
      const b = decide(2, [...subs].reverse(), false);
      expect(b.status).toBe(a.status);
      if (a.status === "verified")
        expect(subs.filter((s) => s.hash === a.hash).length).toBeGreaterThanOrEqual(2);
    }
  });
});
