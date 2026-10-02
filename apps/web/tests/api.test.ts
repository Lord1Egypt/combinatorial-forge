import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineCall } from "@/lib/engine";

const ADMIN = "test-admin-token-0123456789-abcdefghij";
let dir: string;
type Handler = (...a: never[]) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "forge-api-"));
  process.env.TURSO_DATABASE_URL = `file:${path.join(dir, "api.db")}`;
  process.env.ADMIN_TOKEN = ADMIN;
  delete process.env.FORGE_REQUIRE_DISTINCT_NETWORKS;
  const load = async (name: string, mod: Promise<object>) =>
    (routes[name] = (await mod) as Record<string, Handler>);
  await load("health", import("@/app/api/v1/health/route"));
  await load("claim", import("@/app/api/v1/jobs/claim/route"));
  await load("submit", import("@/app/api/v1/jobs/[id]/submit/route"));
  await load("checkpoint", import("@/app/api/v1/jobs/[id]/checkpoint/route"));
  await load("release", import("@/app/api/v1/jobs/[id]/release/route"));
  await load("runs", import("@/app/api/v1/admin/runs/route"));
  await load("verify", import("@/app/api/v1/admin/verify/route"));
  await load("snapshot", import("@/app/api/v1/admin/snapshot/route"));
  await load("importChess", import("@/app/api/v1/admin/import-chess/route"));
  await load("maintenance", import("@/app/api/v1/admin/maintenance/route"));
  await load("jobsBrowser", import("@/app/api/v1/explorer/jobs/route"));
  await load("explorer", import("@/app/api/v1/explorer/[problem]/[[...slug]]/route"));
  await load("stats", import("@/app/api/v1/stats/route"));
  await load("problems", import("@/app/api/v1/problems/route"));
  await load("results", import("@/app/api/v1/results/[problem]/route"));
  await load("snapshots", import("@/app/api/v1/snapshots/route"));
  await load("snapshotFile", import("@/app/api/v1/snapshots/[id]/[file]/route"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let ipCounter = 0;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (url: string) => new Request(`http://localhost${url}`);
const admin = { authorization: `Bearer ${ADMIN}` };
const call = async (name: string, request: Request, params?: unknown) => {
  const handler = (routes[name].POST ?? routes[name].GET) as (
    r: Request,
    c: { params: Promise<unknown> },
  ) => Promise<Response>;
  const response = await handler(request, { params: Promise.resolve(params ?? {}) });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: response.headers,
  };
};
const caps = { engine_version: "forge-engine/1", platform: "test-platform" };
const wid = (n: string) => `worker-${n}-0000`;

describe("service", () => {
  it("reports health with a migrated database and no secrets", async () => {
    const { status, body } = await call("health", get("/api/v1/health"));
    expect(status).toBe(200);
    expect(body).toMatchObject({ service: "combinatorial-forge", database: "ok", schema_version: 3 });
    expect(JSON.stringify(body)).not.toContain(ADMIN);
  });
});

describe("admin authentication (fails closed)", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await call("runs", post("/api/v1/admin/runs", { problem: "nqueens", n: 6 }))).status).toBe(401);
    expect(
      (
        await call(
          "runs",
          post("/api/v1/admin/runs", { problem: "nqueens", n: 6 }, { authorization: "Bearer wrong" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await call("runs", post("/api/v1/admin/runs", { problem: "nqueens", n: 6 }, { authorization: ADMIN })))
        .status,
    ).toBe(401);
  });

  it("locks an address out after repeated failures", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9", authorization: "Bearer nope" };
    const codes: number[] = [];
    for (let i = 0; i < 9; i++)
      codes.push((await call("runs", post("/api/v1/admin/runs", {}, headers))).status);
    expect(codes).toContain(429);
    // even the right token is refused from a locked-out address until it refills
    expect(
      (
        await call(
          "runs",
          post(
            "/api/v1/admin/runs",
            { problem: "nqueens", n: 6 },
            { ...headers, authorization: `Bearer ${ADMIN}` },
          ),
        )
      ).status,
    ).toBe(429);
  });

  it("is disabled entirely when ADMIN_TOKEN is missing or too short", async () => {
    const saved = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "short";
    try {
      const r = await call(
        "runs",
        post("/api/v1/admin/runs", { problem: "nqueens", n: 6 }, { authorization: "Bearer short" }),
      );
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("admin_disabled");
    } finally {
      process.env.ADMIN_TOKEN = saved;
    }
  });
});

describe("contribution endpoint validation", () => {
  it("rejects malformed, oversized and mistyped requests with safe errors", async () => {
    const bad = [
      [post("/api/v1/jobs/claim", { worker_id: "x", problem: "nqueens", capabilities: caps }), 400],
      [post("/api/v1/jobs/claim", { worker_id: wid("a"), problem: "NQ; DROP", capabilities: caps }), 400],
      [
        post("/api/v1/jobs/claim", {
          worker_id: wid("a"),
          problem: "nqueens",
          capabilities: { engine_version: "old" },
        }),
        426,
      ],
      [post("/api/v1/jobs/claim", "not json"), 400],
      [post("/api/v1/jobs/claim", "[1,2]"), 400],
      [post("/api/v1/jobs/claim", { pad: "x".repeat(20_000) }), 413],
      [post("/api/v1/jobs/claim", {}, { "content-type": "text/plain" }), 415],
    ] as const;
    for (const [request, status] of bad) {
      const r = await call("claim", request);
      expect(r.status).toBe(status);
      expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|node_modules|stack/i);
    }
  });

  it("rate limits bursts from one address", async () => {
    const headers = { "x-forwarded-for": "198.51.100.77" };
    const codes: number[] = [];
    for (let i = 0; i < 75; i++)
      codes.push(
        (
          await call(
            "claim",
            post(
              "/api/v1/jobs/claim",
              { worker_id: wid(`rl${i}`), problem: "nqueens", capabilities: caps },
              headers,
            ),
          )
        ).status,
      );
    expect(codes).toContain(429);
    expect(codes[0]).toBe(200);
  });

  it("returns no job when none exist", async () => {
    const r = await call(
      "claim",
      post("/api/v1/jobs/claim", { worker_id: wid("empty"), problem: "chess", capabilities: caps }),
    );
    expect(r.body).toEqual({ job: null, retry_after_seconds: 30 });
  });
});

describe("full distributed lifecycle through the HTTP API", () => {
  let runId = "";
  let total = 0;

  it("admin creates a deterministic run (idempotently)", async () => {
    const created = await call(
      "runs",
      post("/api/v1/admin/runs", { problem: "nqueens", n: 8, depth: 2 }, admin),
    );
    expect(created.status).toBe(201);
    runId = created.body.run_id;
    total = created.body.total_jobs;
    expect(total).toBeGreaterThan(10);
    const again = await call(
      "runs",
      post("/api/v1/admin/runs", { problem: "nqueens", n: 8, depth: 2 }, admin),
    );
    expect(again.body).toMatchObject({ run_id: runId, newly_inserted: 0 });
    for (const bad of [
      { problem: "nqueens", n: 99 },
      { problem: "go" },
      { problem: "nqueens", n: 8, depth: 9 },
    ])
      expect((await call("runs", post("/api/v1/admin/runs", bad, admin))).status).toBe(400);
  });

  async function work(workerId: string, count: number) {
    const done: string[] = [];
    for (let i = 0; i < count; i++) {
      const claimed = await call(
        "claim",
        post("/api/v1/jobs/claim", {
          worker_id: workerId,
          problem: "nqueens",
          run_id: runId,
          capabilities: caps,
        }),
      );
      if (!claimed.body.job) break;
      const job = claimed.body.job;
      // checkpoint through the API, then compute with the shared engine and submit
      const cp = await call(
        "checkpoint",
        post(`/api/v1/jobs/${job.job_id}/checkpoint`, {
          worker_id: workerId,
          lease_token: job.lease_token,
          checkpoint: { cursor: 0, count: 0, nodes: 0 },
          nodes_processed: 0,
        }),
        { id: job.job_id },
      );
      expect(cp.status).toBe(200);
      let state: unknown = null;
      let step: { done: boolean; state: unknown; nodes: number; result: Record<string, number> };
      do {
        step = await engineCall("job.step", { def: job.payload, state, budget: 50_000 });
        state = step.state;
      } while (!step.done);
      const hash = createHash("sha256").update(JSON.stringify(step.result)).digest("hex");
      const submitted = await call(
        "submit",
        post(`/api/v1/jobs/${job.job_id}/submit`, {
          worker_id: workerId,
          lease_token: job.lease_token,
          result: step.result,
          result_hash: hash,
          nodes_processed: step.nodes,
          runtime_ms: 3,
          platform: "test-platform",
        }),
        { id: job.job_id },
      );
      expect(submitted.status).toBe(200);
      done.push(job.job_id);
    }
    return done;
  }

  it("a wrong lease token cannot submit", async () => {
    const claimed = await call(
      "claim",
      post("/api/v1/jobs/claim", {
        worker_id: wid("tok"),
        problem: "nqueens",
        run_id: runId,
        capabilities: caps,
      }),
    );
    const job = claimed.body.job;
    const r = await call(
      "submit",
      post(`/api/v1/jobs/${job.job_id}/submit`, {
        worker_id: wid("tok"),
        lease_token: "A".repeat(43),
        result: { solutions: 0 },
      }),
      { id: job.job_id },
    );
    expect(r.status).toBe(403);
    const released = await call(
      "release",
      post(`/api/v1/jobs/${job.job_id}/release`, { worker_id: wid("tok"), lease_token: job.lease_token }),
      { id: job.job_id },
    );
    expect(released.status).toBe(200);
  });

  it("two independent workers produce VERIFIED results; the run aggregates to the exact count", async () => {
    await work(wid("A"), total);
    let stats = await call("stats", get("/api/v1/stats"));
    const submittedOnly = stats.body.by_status.find((s: { status: string }) => s.status === "submitted");
    expect(submittedOnly.jobs).toBe(total); // one submission each: SUBMITTED, never VERIFIED
    expect(stats.body.by_status.find((s: { status: string }) => s.status === "verified")).toBeUndefined();
    await work(wid("B"), total);
    stats = await call("stats", get("/api/v1/stats"));
    expect(stats.body.by_status.find((s: { status: string }) => s.status === "verified").jobs).toBe(total);
    const run = stats.body.runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(run.complete).toBe(true);
    expect(run.aggregate.solutions).toBe(92);
  });

  it("the job browser filters and exports; hostile parameters are rejected", async () => {
    const page = await call(
      "jobsBrowser",
      get(`/api/v1/explorer/jobs?problem=nqueens&status=verified&run=${runId}&limit=3`),
    );
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(total);
    expect(page.body.jobs).toHaveLength(3);
    expect(page.body.jobs[0].verified_result).toHaveProperty("solutions");
    const download = await call("jobsBrowser", get("/api/v1/explorer/jobs?limit=2&download=1"));
    expect(download.headers.get("content-disposition")).toContain("forge-jobs.json");
    for (const q of [
      "status=bogus",
      "limit=999",
      "limit=-1",
      "run=x%27%20OR%201=1",
      "depth=abc",
      "problem=NQ%3B",
    ])
      expect((await call("jobsBrowser", get(`/api/v1/explorer/jobs?${q}`))).status).toBe(400);
  });

  it("trusted recompute reopens nothing when results agree, and snapshots publish verified data only", async () => {
    const first = await call("jobsBrowser", get(`/api/v1/explorer/jobs?run=${runId}&limit=1`));
    const jobId = first.body.jobs[0].job_id;
    const audit = await call(
      "verify",
      post("/api/v1/admin/verify", { job_id: jobId, mode: "recompute" }, admin),
    );
    expect(audit.status).toBe(200);
    expect(audit.body.status).toBe("verified");
    const snap = await call("snapshot", post("/api/v1/admin/snapshot", { project_commit: "unknown" }, admin));
    expect(snap.status).toBe(201);
    const id = snap.body.snapshot_id;
    const sums = await (
      await routes.snapshotFile.GET(
        get("/") as never,
        { params: Promise.resolve({ id, file: "SHA256SUMS" }) } as never,
      )
    ).text();
    for (const line of sums.trim().split("\n")) {
      const [hash, name] = line.split("  ");
      const file = await routes.snapshotFile.GET(
        get("/") as never,
        { params: Promise.resolve({ id, file: name }) } as never,
      );
      expect(
        createHash("sha256")
          .update(await file.text())
          .digest("hex"),
      ).toBe(hash);
    }
    expect(snap.body.manifest.verified_job_counts.nqueens).toBe(total);
    expect(snap.body.manifest.aggregate_results[0].result.solutions).toBe(92);
    expect((await call("snapshotFile", get("/"), { id: "../../etc", file: "manifest.json" })).status).toBe(
      404,
    );
    expect((await call("snapshotFile", get("/"), { id, file: "../x" })).status).toBe(404);
    const list = await call("snapshots", get("/api/v1/snapshots"));
    expect(list.body.snapshots[0].snapshot_id).toBe(id);
  });

  it("cancel and reopen administration works", async () => {
    expect(
      (await call("maintenance", post("/api/v1/admin/maintenance", { action: "expire" }, admin))).status,
    ).toBe(200);
    expect(
      (
        await call(
          "maintenance",
          post("/api/v1/admin/maintenance", { action: "reopen_failed", run_id: runId }, admin),
        )
      ).body.reopened,
    ).toBe(0);
    expect(
      (await call("maintenance", post("/api/v1/admin/maintenance", { action: "explode" }, admin))).status,
    ).toBe(400);
  });
});

describe("explorer and results endpoints", () => {
  it("serves canonical results derived from results/*.json", async () => {
    const q = await call("results", get("/"), { problem: "nqueens" });
    expect(q.body.result.rows.find((r: { n: number }) => r.n === 18).solutions).toBe(666090624);
    expect((await call("results", get("/"), { problem: "tictactoe" })).body.result).toMatchObject({
      reachable_positions: 5478,
      complete_games: 255168,
    });
    expect((await call("results", get("/"), { problem: "eight_puzzle" })).body.result).toMatchObject({
      reachable_states: 181440,
      diameter: 31,
    });
    expect((await call("results", get("/"), { problem: "lights_out" })).body.result).toMatchObject({
      solvable_states: 8388608,
      maximum_minimum_moves: 15,
    });
    const chess = await call("results", get("/"), { problem: "chess" });
    expect(chess.body.solved).toBe(false);
    expect((await call("results", get("/"), { problem: "go" })).status).toBe(404);
  });

  it("explores each problem through the shared engine", async () => {
    const ex = (problem: string, query = "", slug: string[] = []) =>
      call("explorer", get(`/api/v1/explorer/${problem}${query}`), { problem, slug });
    expect((await ex("nqueens", "?n=8")).body).toMatchObject({
      solutions: 92,
      examples: { solutions: expect.any(Array) },
    });
    expect((await ex("nqueens", "?n=19")).status).toBe(404);
    expect((await ex("nqueens", "?n=abc")).status).toBe(400);
    expect((await ex("tictactoe", "?board=xo-------")).body.position).toMatchObject({
      turn: "x",
      minimax: "x_win",
      ply: 2,
    });
    expect((await ex("tictactoe", "?board=xxxxxxxxx")).body.position.reachable).toBe(false);
    expect((await ex("tictactoe", "?board=bad")).status).toBe(400);
    expect((await ex("eight_puzzle", "?board=123456708")).body.solution).toMatchObject({
      solvable: true,
      distance: 1,
      moves: "R",
    });
    expect((await ex("eight_puzzle", "?board=123456870")).body.solution.solvable).toBe(false);
    expect((await ex("eight_puzzle", "?board=112345678")).status).toBe(400);
    expect((await ex("lights_out")).body.solution).toMatchObject({ solvable: expect.any(Boolean) });
    expect((await ex("lights_out", `?board=${"1".repeat(25)}`)).body.solution.solvable).toBe(true);
    expect((await ex("lights_out", "?board=12")).status).toBe(400);
    const start = await ex("chess");
    expect(start.body).toMatchObject({ source: "computed", legal_moves: 20 });
    const moved = await ex(
      "chess",
      `?epd=${encodeURIComponent("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -")}`,
    );
    expect(moved.body.legal_moves).toBe(20);
    expect((await ex("chess", `?epd=${encodeURIComponent("../../etc/passwd")}`)).status).toBe(400);
    expect((await ex("chess", "", ["position", "z".repeat(32)])).status).toBe(400);
    expect((await ex("chess", "", ["position", "0".repeat(32)])).status).toBe(404);
    expect((await ex("go")).status).toBe(404);
  });

  it("imports verified chess rows only when ids match the position", async () => {
    const root = await engineCall<{
      id: string;
      epd: string;
      legal_moves: number;
      children: { id: string; epd: string; uci: string }[];
    }>("chess.position", { epd: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -" });
    const kid = root.children[0];
    const ok = await call(
      "importChess",
      post(
        "/api/v1/admin/import-chess",
        {
          positions: [
            { position_id: root.id, epd: root.epd, first_ply: 0 },
            { position_id: kid.id, epd: kid.epd, first_ply: 1 },
          ],
          edges: [{ parent_id: root.id, child_id: kid.id, uci: kid.uci }],
          layers: [
            { run_id: "abcdef012345", ply: 1, unique_positions: 20, move_sequences: 20, status: "complete" },
          ],
        },
        admin,
      ),
    );
    expect(ok.body).toEqual({ positions: 2, edges: 1, layers: 1 });
    const bad = await call(
      "importChess",
      post(
        "/api/v1/admin/import-chess",
        { positions: [{ position_id: "0".repeat(32), epd: root.epd, first_ply: 0 }] },
        admin,
      ),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("id_mismatch");
    expect(
      (
        await call(
          "importChess",
          post("/api/v1/admin/import-chess", { positions: Array(2001).fill({}) }, admin),
        )
      ).status,
    ).toBe(400);
    expect((await call("importChess", post("/api/v1/admin/import-chess", { positions: [] }))).status).toBe(
      401,
    );
    const stored = await call("explorer", get("/"), { problem: "chess", slug: ["position", root.id] });
    expect(stored.body).toMatchObject({ source: "stored", legal_moves: 20, first_ply: 0 });
    expect(stored.body.children[0]).toEqual({ id: kid.id, uci: kid.uci });
    const kidView = await call("explorer", get("/"), { problem: "chess", slug: ["position", kid.id] });
    expect(kidView.body.parents).toEqual([{ id: root.id, uci: kid.uci }]);
    const layers = await call("explorer", get("/"), { problem: "chess", slug: ["layers"] });
    expect(layers.body.layers[0]).toMatchObject({ ply: 1, unique_positions: 20, move_sequences: 20 });
  });

  it("lists problems with verification policy", async () => {
    const r = await call("problems", get("/api/v1/problems"));
    const chess = r.body.problems.find((p: { id: string }) => p.id === "chess");
    expect(chess).toMatchObject({ status: "research", verification_policy: { required_matches: 2 } });
  });
});
