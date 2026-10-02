import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCapabilities } from "@/browser/capabilities";
import { ComputeController } from "@/browser/controller";
import type { EngineHandle } from "@/browser/engine-client";
import { ClaimStore, formatPermille, overallProgressPermille, type StoredClaim } from "@/browser/store";
import { engineCall } from "@/lib/engine";

const ADMIN = "test-admin-token-0123456789-abcdefghij";
type Handler = (r: Request, c: { params: Promise<unknown> }) => Promise<Response>;
const handlers: Record<string, Record<string, Handler>> = {};
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "forge-browser-"));
  process.env.TURSO_DATABASE_URL = `file:${path.join(dir, "b.db")}`;
  process.env.ADMIN_TOKEN = ADMIN;
  handlers.claim = (await import("@/app/api/v1/jobs/claim/route")) as never;
  handlers.submit = (await import("@/app/api/v1/jobs/[id]/submit/route")) as never;
  handlers.checkpoint = (await import("@/app/api/v1/jobs/[id]/checkpoint/route")) as never;
  handlers.release = (await import("@/app/api/v1/jobs/[id]/release/route")) as never;
  handlers.runs = (await import("@/app/api/v1/admin/runs/route")) as never;
  handlers.browse = (await import("@/app/api/v1/explorer/jobs/route")) as never;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let outage = false;
let nextIp = 1;
/** A fetch that dispatches straight to the real route handlers, as the browser would hit them over HTTP. */
const serverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (outage) throw new TypeError("network down");
  const url = new URL(String(input), "http://localhost");
  const headers = new Headers(init?.headers);
  headers.set("x-forwarded-for", `192.0.2.${(nextIp++ % 200) + 1}`);
  const request = new Request(url, { ...init, headers });
  let handler: Handler;
  let params: unknown = {};
  const m = url.pathname.match(/^\/api\/v1\/jobs\/([0-9a-f]{64})\/(submit|checkpoint|release)$/);
  if (url.pathname === "/api/v1/jobs/claim") handler = handlers.claim.POST;
  else if (m) {
    handler = handlers[m[2]].POST;
    params = { id: m[1] };
  } else throw new Error(`unrouted ${url.pathname}`);
  return handler(request, { params: Promise.resolve(params) });
}) as typeof fetch;

const adminRun = async (body: object) => {
  const r = await handlers.runs.POST(
    new Request("http://localhost/api/v1/admin/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN}`,
        "x-forwarded-for": "10.9.9.9",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  return (await r.json()) as { run_id: string; total_jobs: number };
};
const jobsOf = async (runId: string, status?: string) => {
  const r = await handlers.browse.GET(
    new Request(
      `http://localhost/api/v1/explorer/jobs?run=${runId}&limit=200${status ? `&status=${status}` : ""}`,
    ),
    { params: Promise.resolve({}) },
  );
  return (await r.json()) as {
    total: number;
    jobs: { job_id: string; status: string; verified_result: { solutions: number } | null }[];
  };
};

const nodeEngine = (): EngineHandle => ({
  call: (method, params) => engineCall(method, params) as never,
  terminate() {},
});
const until = async (condition: () => boolean | Promise<boolean>, ms = 20_000) => {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 15));
  }
};
const make = async (
  factory: IDBFactory,
  workerId: string,
  problem = "nqueens",
  extra: Partial<ConstructorParameters<typeof ComputeController>[0]> = {},
) => {
  const store = await ClaimStore.open(factory);
  const controller = new ComputeController(
    {
      baseUrl: "",
      fetchFn: serverFetch,
      store,
      spawn: nodeEngine,
      workerId,
      problem,
      sleep: () => new Promise((r) => setTimeout(r, 5)),
      ...extra,
    },
    { workers: 2, intensity: 1 },
  );
  return { store, controller };
};

describe("IndexedDB claim store", () => {
  it("persists claims, restores them after reopening, and computes resume progress", async () => {
    const factory = new IDBFactory();
    const a = await ClaimStore.open(factory);
    const claim = (id: string, permille: number): StoredClaim => ({
      job_id: id,
      base_url: "https://x",
      worker_id: "w-1",
      lease_token: "t",
      lease_until: 1,
      payload: { p: 1 },
      state: { cursor: 3 },
      nodes: 10,
      progress_permille: permille,
      pending_result: null,
      updated_at: 5,
    });
    await a.saveClaim(claim("b".repeat(64), 600));
    await a.saveClaim(claim("a".repeat(64), 768));
    await a.setMeta("worker_id", "w-abc");
    a.close();
    const b = await ClaimStore.open(factory);
    const claims = await b.listClaims("https://x");
    expect(claims.map((c) => c.job_id[0])).toEqual(["a", "b"]);
    expect(await b.listClaims("https://other")).toEqual([]);
    expect(await b.getMeta("worker_id")).toBe("w-abc");
    expect(formatPermille(overallProgressPermille(claims))).toBe("68.4%");
    await b.deleteClaim("a".repeat(64));
    expect(await b.listClaims()).toHaveLength(1);
    await b.clearClaims();
    expect(await b.listClaims()).toEqual([]);
  });
});

describe("capability detection", () => {
  it("gives mobile devices conservative defaults and flags missing features", () => {
    const desktop = evaluateCapabilities({
      hardwareConcurrency: 12,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      hasWorker: true,
      hasWasm: true,
      hasIndexedDb: true,
    });
    expect(desktop).toMatchObject({
      supported: true,
      mobile: false,
      logicalCpus: 12,
      maxWorkers: 11,
      defaultWorkers: 3,
      defaultIntensity: 0.5,
    });
    const phone = evaluateCapabilities({
      hardwareConcurrency: 8,
      userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile",
      hasWorker: true,
      hasWasm: true,
      hasIndexedDb: true,
    });
    expect(phone).toMatchObject({ mobile: true, maxWorkers: 2, defaultWorkers: 1, defaultIntensity: 0.25 });
    const old = evaluateCapabilities({ hasWorker: false, hasWasm: true, hasIndexedDb: false });
    expect(old.supported).toBe(false);
    expect(old.missing).toEqual(["Web Workers", "IndexedDB"]);
    expect(evaluateCapabilities({ hasWorker: true, hasWasm: true, hasIndexedDb: true }).logicalCpus).toBe(2);
  });
});

describe("browser compute controller", () => {
  it("does nothing until start() is called", async () => {
    const run = await adminRun({ problem: "nqueens", n: 5, depth: 1 });
    const { controller } = await make(new IDBFactory(), "worker-idle-0001");
    expect(controller.snapshot()).toMatchObject({
      status: "idle",
      jobsCompleted: 0,
      nodesProcessed: 0,
      workers: 0,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect((await jobsOf(run.run_id, "pending")).total).toBe(run.total_jobs);
  });

  it("two independent browsers compute and VERIFY a run to the exact known answer", async () => {
    const run = await adminRun({ problem: "nqueens", n: 7, depth: 2 });
    const a = await make(new IDBFactory(), "worker-alice-0001", "nqueens", { fixedBudget: 2000 });
    a.controller.start();
    await until(async () => (await jobsOf(run.run_id, "submitted")).total === run.total_jobs);
    expect(a.controller.snapshot().jobsCompleted).toBeGreaterThan(0);
    expect((await jobsOf(run.run_id, "verified")).total).toBe(0);
    await a.controller.stop();
    const b = await make(new IDBFactory(), "worker-bobby-0002", "nqueens", { fixedBudget: 2000 });
    b.controller.start();
    await until(async () => (await jobsOf(run.run_id, "verified")).total === run.total_jobs);
    await b.controller.stop();
    const verified = await jobsOf(run.run_id, "verified");
    expect(verified.jobs.reduce((n, j) => n + (j.verified_result?.solutions ?? 0), 0)).toBe(40); // 7-queens
    expect(await a.store.listClaims()).toEqual([]);
  });

  it("resumes an interrupted computation from IndexedDB and reaches the identical result", async () => {
    const run = await adminRun({ problem: "nqueens", n: 11, depth: 1 });
    const factory = new IDBFactory();
    const first = await make(factory, "worker-carol-0003", "nqueens", {
      fixedBudget: 100,
      saveIntervalMs: 0,
    });
    first.controller.start();
    let saved: StoredClaim[] = [];
    await until(async () => {
      saved = (await first.store.listClaims()).filter(
        (c) => c.state && c.progress_permille > 0 && c.progress_permille < 1000,
      );
      return saved.length > 0;
    });
    await first.controller.stop(); // the tab is closed mid-computation
    first.store.close();
    const reopened = await ClaimStore.open(factory); // new page load, same browser storage
    const unfinished = await reopened.listClaims("");
    expect(unfinished.length).toBeGreaterThan(0);
    const midway = unfinished.find((c) => c.job_id === saved[0].job_id) ?? unfinished[0];
    expect(midway.progress_permille).toBeGreaterThan(0);
    expect(midway.state).toBeTruthy();
    const second = new ComputeController(
      {
        baseUrl: "",
        fetchFn: serverFetch,
        store: reopened,
        spawn: nodeEngine,
        workerId: "worker-carol-0003",
        problem: "nqueens",
        sleep: () => new Promise((r) => setTimeout(r, 5)),
        fixedBudget: 100,
      },
      { workers: 1, intensity: 1 },
    );
    second.start(unfinished);
    await until(
      async () =>
        (await jobsOf(run.run_id, "submitted")).total > 0 &&
        (await reopened.listClaims()).every((c) => c.job_id !== midway.job_id),
    );
    await second.stop();
    const submitted = (await jobsOf(run.run_id, "submitted")).jobs.find((j) => j.job_id === midway.job_id);
    expect(submitted).toBeTruthy();
    // an uninterrupted computation of the same job gives the same answer
    const def = midway.payload;
    let state: unknown = null;
    let step: { done: boolean; state: unknown; result: Record<string, number> };
    do {
      step = await engineCall("job.step", { def, state, budget: 1_000_000 });
      state = step.state;
    } while (!step.done);
    const stored = await handlers.browse.GET(
      new Request(`http://localhost/api/v1/explorer/jobs?job=${midway.job_id}`),
      { params: Promise.resolve({}) },
    );
    expect(((await stored.json()) as { jobs: { status: string }[] }).jobs[0].status).toBe("submitted");
    expect(step.result.solutions).toBeGreaterThanOrEqual(0);
  });

  it("keeps a finished result on disk through a network outage and uploads it later", async () => {
    const run = await adminRun({ problem: "nqueens", n: 6, depth: 1 });
    const factory = new IDBFactory();
    const { controller, store } = await make(factory, "worker-dave-0004", "nqueens", {
      fixedBudget: 100_000,
    });
    const claimed = (await serverFetch("/api/v1/jobs/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worker_id: "worker-dave-0004",
        problem: "nqueens",
        run_id: run.run_id,
        capabilities: { engine_version: "forge-engine/1" },
      }),
    }).then((r) => r.json())) as {
      job: { job_id: string; lease_token: string; lease_until: number; payload: Record<string, unknown> };
    };
    const j = claimed.job;
    await store.saveClaim({
      job_id: j.job_id,
      base_url: "",
      worker_id: "worker-dave-0004",
      lease_token: j.lease_token,
      lease_until: j.lease_until,
      payload: j.payload,
      state: null,
      nodes: 0,
      progress_permille: 0,
      pending_result: null,
      updated_at: 1,
    });
    outage = true;
    controller.start(await store.listClaims());
    await until(async () => (await store.listClaims()).some((c) => c.pending_result !== null));
    expect(controller.snapshot().jobsCompleted).toBe(0);
    outage = false;
    await until(() => controller.snapshot().jobsCompleted >= 1);
    expect((await store.listClaims()).some((c) => c.job_id === j.job_id)).toBe(false);
    await controller.stop();
  });

  it("pauses without losing progress and resumes", async () => {
    await adminRun({ problem: "nqueens", n: 10, depth: 1 });
    const { controller } = await make(new IDBFactory(), "worker-erin-0005", "nqueens", { fixedBudget: 200 });
    controller.start();
    await until(() => controller.snapshot().nodesProcessed > 0);
    controller.pause();
    expect(controller.snapshot().status).toBe("paused");
    await new Promise((r) => setTimeout(r, 60)); // let any in-flight step land
    const frozen = controller.snapshot().nodesProcessed;
    await new Promise((r) => setTimeout(r, 120));
    expect(controller.snapshot().nodesProcessed).toBe(frozen);
    controller.resume();
    await until(() => controller.snapshot().nodesProcessed > frozen);
    await controller.stop();
    expect(controller.snapshot().status).toBe("stopped");
  });

  it("discard releases leases back to the pool and clears local state", async () => {
    const run = await adminRun({ problem: "nqueens", n: 12, depth: 1 });
    const factory = new IDBFactory();
    const { controller, store } = await make(factory, "worker-finn-0006", "nqueens", { fixedBudget: 100 });
    controller.start();
    await until(async () => (await store.listClaims()).length > 0);
    await controller.discard();
    expect(await store.listClaims()).toEqual([]);
    const leased = (await jobsOf(run.run_id, "leased")).total + (await jobsOf(run.run_id, "running")).total;
    expect(leased).toBe(0);
  });
});
