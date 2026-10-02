import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { engineCall } from "@/lib/engine";

const forge = path.join(__dirname, "..", "..", "..", "build", "forge");
const wasmDir = path.join(__dirname, "..", "public", "wasm");
const requireWasm = createRequire(path.join(wasmDir, "loader.cjs"));
interface WasmModule {
  ccall(name: string, returnType: "string", argTypes: ["string"], args: [string]): string;
}
let loading: Promise<WasmModule> | undefined;
const native = (method: string, params: object = {}) => {
  const call = spawnSync(forge, ["call", JSON.stringify({ method, params })], { encoding: "utf8" });
  if (call.error) throw call.error;
  if (call.status !== 0 && call.status !== 1) throw new Error(call.stderr || `forge exited ${call.status}`);
  return call.stdout.trim();
};
const wasm = async (method: string, params: object = {}) => {
  loading ??= (requireWasm(path.join(wasmDir, "forge.js")) as (options: object) => Promise<WasmModule>)({
    wasmBinary: readFileSync(path.join(wasmDir, "forge.wasm")),
  });
  return (await loading).ccall("forge_call", "string", ["string"], [JSON.stringify({ method, params })]);
};
const unwrap = (text: string) => {
  const reply = JSON.parse(text) as { ok: boolean; result?: unknown };
  return reply.result;
};

let seed = 20260502;
const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;

describe.skipIf(!existsSync(forge))("WebAssembly and native engines are equivalent", () => {
  it("matches the recorded binary and shared-engine source hashes", () => {
    const info = JSON.parse(readFileSync(path.join(wasmDir, "build-info.json"), "utf8")) as Record<
      string,
      string
    >;
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    for (const file of ["forge.js", "forge.wasm"])
      expect(sha(readFileSync(path.join(wasmDir, file)))).toBe(info[file]);
    const source = createHash("sha256");
    const headers = path.join(__dirname, "..", "..", "..", "engine", "forge");
    for (const file of readdirSync(headers)
      .filter((name) => name.endsWith(".hpp"))
      .sort())
      source.update(readFileSync(path.join(headers, file)));
    source.update(readFileSync(path.join(__dirname, "..", "..", "..", "wasm", "forge_wasm.cpp")));
    expect(source.digest("hex")).toBe(info.engine_sources_sha256);
  });

  const cases: [string, object][] = [
    ["engine.info", {}],
    ["ttt.stats", {}],
    ["ttt.position", { board: "xo-------" }],
    ["ttt.position", { board: "xox-o-x--" }],
    ["puzzle8.stats", {}],
    ["puzzle8.solve", { board: "123456708" }],
    ["puzzle8.solve", { board: "876543210" }],
    ["puzzle8.solve", { board: "123456870" }],
    ["lights.info", {}],
    ["lights.solve", { board: "1".repeat(25) }],
    ["lights.solve", { board: "0".repeat(24) + "1" }],
    ["nqueens.examples", { n: 8, limit: 5 }],
    ["chess.position", { epd: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -" }],
    ["chess.position", { epd: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -" }],
    ["chess.position", { epd: "rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3" }],
    ["chess.perft", { epd: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", depth: 4 }],
    ["chess.perft", { epd: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", depth: 5 }],
    ["job.plan", { problem: "nqueens", n: 9, depth: 2 }],
    ["job.plan", { problem: "chess", path_depth: 2, depth: 4 }],
    ["result.hash", { result: { solutions: 92 } }],
    ["bogus.method", {}],
    ["puzzle8.solve", { board: "12345" }],
  ];

  for (const [method, params] of cases) {
    it(`${method} ${JSON.stringify(params).slice(0, 60)}`, async () => {
      const nativeText = native(method, params);
      expect(await wasm(method, params)).toBe(nativeText);
    });
  }

  it("matches randomized valid queries across the finite puzzles", async () => {
    for (let i = 0; i < 30; i++) {
      const board = "123456780".split("");
      for (let j = board.length - 1; j > 0; j--) {
        const k = rnd(j + 1);
        [board[j], board[k]] = [board[k], board[j]];
      }
      const lights = Array.from({ length: 25 }, () => String(rnd(2))).join("");
      const ttt = "---------".split("");
      for (let j = 0; j < rnd(5); j++) {
        const open = ttt.map((v, k) => (v === "-" ? k : -1)).filter((k) => k >= 0);
        ttt[open[rnd(open.length)]] = j % 2 ? "o" : "x";
      }
      for (const [method, params] of [
        ["puzzle8.solve", { board: board.join("") }],
        ["lights.solve", { board: lights }],
        ["ttt.position", { board: ttt.join("") }],
      ] as const)
        expect(await wasm(method, params)).toBe(native(method, params));
    }
  });

  it("agrees on job identifiers and every checkpointed step of random jobs", async () => {
    const queens = (
      await engineCall<{ jobs: unknown[] }>("job.plan", { problem: "nqueens", n: 10, depth: 3 })
    ).jobs;
    const chess = (
      await engineCall<{ jobs: unknown[] }>("job.plan", { problem: "chess", path_depth: 2, depth: 4 })
    ).jobs;
    for (let i = 0; i < 12; i++) {
      const def = i % 2 ? queens[rnd(queens.length)] : chess[rnd(chess.length)];
      const budget = 200 + rnd(5000);
      expect(await wasm("job.id", { def })).toBe(native("job.id", { def }));
      let state: unknown = null;
      for (let step = 0; step < 6; step++) {
        const request = { def, state, budget };
        const wasmText = await wasm("job.step", request);
        const nativeText = native("job.step", request);
        expect(wasmText).toBe(nativeText);
        const w = unwrap(wasmText) as { done: boolean; state: unknown };
        state = w.state;
        if (w.done) break;
      }
    }
  });

  it("reproduces the shared job-id fixtures", async () => {
    const fixtures = (await import("../../../database/fixtures/job_ids.json")).default as {
      cases: { definition: object; job_id: string }[];
    };
    for (const c of fixtures.cases)
      expect(((await engineCall("job.id", { def: c.definition })) as { job_id: string }).job_id).toBe(
        c.job_id,
      );
  });
});
