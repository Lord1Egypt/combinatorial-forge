import { describe, expect, it } from "vitest";
import { engineCall } from "@/lib/engine";
import { validateJobDefinition, validateResult, type JobDefinition } from "@/lib/validate";

const chess = (path: string[], depth: number) => ({
  algorithm: "perft",
  depth,
  parameters: {},
  partition: { path },
  problem: "chess",
  problem_version: "1",
  range: null,
  root_state: { epd: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -" },
  solver_version: "chess-perft/1",
});
const queens = (n: number, prefix: number[]) => ({
  algorithm: "bitmask-prefix",
  depth: null,
  parameters: { n },
  partition: { prefix },
  problem: "nqueens",
  problem_version: "1",
  range: null,
  root_state: null,
  solver_version: "nqueens-bitmask-prefix/1",
});

describe("job definition validation", () => {
  it("accepts well-formed definitions", () => {
    expect(() => validateJobDefinition(queens(8, [0, 2]))).not.toThrow();
    expect(() => validateJobDefinition(chess(["e2e4"], 3))).not.toThrow();
  });

  it.each([
    ["extra field", { ...queens(8, []), extra: 1 }],
    [
      "missing field",
      (() => {
        const d: Record<string, unknown> = { ...queens(8, []) };
        delete d.depth;
        return d;
      })(),
    ],
    ["unknown problem", { ...queens(8, []), problem: "go" }],
    ["n too large for exact JS counting", queens(25, [])],
    ["n not an integer", queens(8.5, [])],
    ["attacking prefix", queens(8, [0, 1])],
    ["column out of range", queens(8, [9])],
    ["wrong solver version", { ...queens(8, []), solver_version: "evil/1" }],
    ["chess depth too deep", chess([], 9)],
    ["chess bad move", chess(["e2-e4"], 2)],
    ["chess path too long", chess(Array(17).fill("e2e4"), 2)],
    ["chess malformed epd", { ...chess([], 2), root_state: { epd: "../../etc/passwd" } }],
    ["not an object", [1, 2]],
    ["null", null],
  ])("rejects %s", (_name, def) => {
    expect(() => validateJobDefinition(def)).toThrow();
  });

  it("agrees with the native engine about what is a valid definition", async () => {
    const samples = [
      queens(8, [0, 2]),
      queens(8, [0, 1]),
      chess(["e2e4"], 3),
      chess(["e2e4"], 12),
      { ...queens(8, []), problem: "go" },
    ];
    for (const def of samples) {
      let engineAccepts = true;
      try {
        await engineCall("job.validate", { def });
      } catch {
        engineAccepts = false;
      }
      let tsAccepts = true;
      try {
        validateJobDefinition(def);
      } catch {
        tsAccepts = false;
      }
      expect(tsAccepts).toBe(engineAccepts);
    }
  });
});

describe("result validation", () => {
  const def = validateJobDefinition(queens(8, [0])) as JobDefinition;
  it("accepts plausible results and rejects malformed or impossible ones", () => {
    expect(validateResult(def, { solutions: 4 })).toEqual({ solutions: 4 });
    for (const bad of [
      { solutions: -1 },
      { solutions: 1.5 },
      { solutions: "4" },
      { solutions: 4, extra: 1 },
      {},
      null,
      [],
      { solutions: 8 ** 8 },
    ])
      expect(() => validateResult(def, bad)).toThrow();
  });

  it("checks chess counters for internal consistency", () => {
    const d = validateJobDefinition(chess(["e2e4"], 2)) as JobDefinition;
    expect(() =>
      validateResult(d, { nodes: 20, captures: 0, en_passant: 0, castles: 0, promotions: 0 }),
    ).not.toThrow();
    expect(() =>
      validateResult(d, { nodes: 20, captures: 21, en_passant: 0, castles: 0, promotions: 0 }),
    ).toThrow();
    expect(() =>
      validateResult(d, { nodes: 20, captures: 1, en_passant: 2, castles: 0, promotions: 0 }),
    ).toThrow();
    expect(() =>
      validateResult(d, { nodes: 10 ** 9, captures: 0, en_passant: 0, castles: 0, promotions: 0 }),
    ).toThrow();
    expect(() => validateResult(d, { nodes: 20 })).toThrow();
  });
});
