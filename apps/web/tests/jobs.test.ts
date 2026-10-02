import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http";
import {
  checkpointJob,
  claimJob,
  listJobs,
  maintenance,
  recomputeAggregate,
  releaseJob,
  submitResult,
  type ClaimedJob,
  type Ctx,
} from "@/lib/jobs";
import { compute, freshEnv, seedNQueens, worker, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await freshEnv();
});
afterEach(() => env.cleanup());

const claimFor = (ctx: Ctx, w: string, problem = "nqueens") => claimJob(ctx, { workerId: w, problem });
async function submitHonest(ctx: Ctx, job: ClaimedJob, w: string, networkHash: string | null = null) {
  const { result, nodes } = await compute(job.payload);
  return submitResult(ctx, {
    jobId: job.job_id,
    workerId: w,
    token: job.lease_token,
    result,
    nodes,
    runtimeMs: 5,
    platform: "test",
    networkHash,
  });
}
async function status(id: string) {
  const r = await env.db.execute({
    sql: "SELECT status, attempts, verification_count, lease_owner FROM jobs WHERE job_id = ?",
    args: [id],
  });
  return r.rows[0];
}

describe("job creation", () => {
  it("creates deterministic jobs and is idempotent", async () => {
    const a = await seedNQueens(env.ctx, 6, 2);
    expect(a.totalJobs).toBe(a.plan.length);
    expect(a.inserted).toBe(a.plan.length);
    const b = await seedNQueens(env.ctx, 6, 2);
    expect(b.runId).toBe(a.runId);
    expect(b.inserted).toBe(0);
    const count = await env.db.execute("SELECT COUNT(*) AS n FROM jobs");
    expect(Number(count.rows[0].n)).toBe(a.plan.length);
  });
});

describe("claiming", () => {
  it("never hands the same job to two workers, even under heavy concurrency", async () => {
    const run = await seedNQueens(env.ctx, 8, 2);
    const claims = await Promise.all(
      Array.from({ length: 40 }, (_, i) => claimFor(env.ctx, worker(`c${i}`))),
    );
    const ids = claims.filter((c) => c).map((c) => c!.job_id);
    expect(ids.length).toBe(Math.min(40, run.totalJobs));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is exclusive across independent connections to the same database", async () => {
    await seedNQueens(env.ctx, 7, 2);
    const second = createClient({ url: `file:${env.file}` });
    const other: Ctx = { ...env.ctx, db: second };
    try {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const claim = await claimFor(i % 2 ? other : env.ctx, worker(`x${i}`));
        if (claim) ids.push(claim.job_id);
      }
      expect(ids.length).toBeGreaterThan(10);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      second.close();
    }
  });

  it("returns null when nothing is claimable, and rejects unknown problems", async () => {
    expect(await claimFor(env.ctx, worker("a"))).toBeNull();
    await expect(claimFor(env.ctx, worker("a"), "go")).rejects.toMatchObject({ code: "unknown_problem" });
  });

  it("does not offer a worker a job it already submitted", async () => {
    await seedNQueens(env.ctx, 4, 1);
    const w = worker("solo");
    const first = (await claimFor(env.ctx, w))!;
    await submitHonest(env.ctx, first, w);
    const next = await claimFor(env.ctx, w);
    expect(next === null || next.job_id !== first.job_id).toBe(true);
  });

  it("prefers finishing verification of already-submitted jobs", async () => {
    await seedNQueens(env.ctx, 6, 2);
    const a = worker("a");
    const first = (await claimFor(env.ctx, a))!;
    await submitHonest(env.ctx, first, a);
    const b = (await claimFor(env.ctx, worker("b")))!;
    expect(b.job_id).toBe(first.job_id);
  });
});

describe("leases", () => {
  it("makes abandoned jobs available again after the lease expires", async () => {
    await seedNQueens(env.ctx, 4, 1);
    const jobs: ClaimedJob[] = [];
    for (let i = 0; i < 10; i++) {
      const j = await claimFor(env.ctx, worker(`l${i}`));
      if (j) jobs.push(j);
    }
    expect(await claimFor(env.ctx, worker("late"))).toBeNull();
    env.clock.now += 901_000;
    const again = await claimFor(env.ctx, worker("rescuer"));
    expect(again).not.toBeNull();
    expect(jobs.map((j) => j.job_id)).toContain(again!.job_id);
    expect(Number((await status(again!.job_id)).attempts)).toBe(2);
  });

  it("rejects a checkpoint from a stale or foreign lease", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const w = worker("w");
    const job = (await claimFor(env.ctx, w))!;
    await expect(
      checkpointJob(env.ctx, {
        jobId: job.job_id,
        workerId: worker("thief"),
        token: job.lease_token,
        checkpoint: {},
        nodes: 1,
      }),
    ).rejects.toMatchObject({ code: "lease_invalid" });
    await expect(
      checkpointJob(env.ctx, {
        jobId: job.job_id,
        workerId: w,
        token: "A".repeat(43),
        checkpoint: {},
        nodes: 1,
      }),
    ).rejects.toMatchObject({ code: "lease_invalid" });
    env.clock.now += 901_000;
    await expect(
      checkpointJob(env.ctx, {
        jobId: job.job_id,
        workerId: w,
        token: job.lease_token,
        checkpoint: {},
        nodes: 1,
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
  });

  it("cannot hijack a lease by presenting another worker's token", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const victim = worker("victim");
    const job = (await claimFor(env.ctx, victim))!;
    const attacker = worker("attacker");
    const { result } = await compute(job.payload);
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: attacker,
        token: job.lease_token,
        result,
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toMatchObject({ code: "lease_invalid" });
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: attacker,
        token: null,
        result,
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toMatchObject({ code: "lease_invalid" });
  });

  it("extends the lease on checkpoint and persists progress for resumption", async () => {
    await seedNQueens(env.ctx, 7, 1);
    const w = worker("cp");
    const job = (await claimFor(env.ctx, w))!;
    env.clock.now += 600_000;
    const state = { cursor: 3, count: 12, nodes: 99 };
    const { lease_until } = await checkpointJob(env.ctx, {
      jobId: job.job_id,
      workerId: w,
      token: job.lease_token,
      checkpoint: state,
      nodes: 99,
    });
    expect(lease_until).toBeGreaterThan(job.lease_until);
    expect((await status(job.job_id)).status).toBe("running");
    env.clock.now += 1_000_000; // abandoned
    const resumed = (await claimFor(env.ctx, worker("next")))!;
    const same = resumed.job_id === job.job_id ? resumed : null;
    // The abandoned job is eligible again and carries its checkpoint to the next worker.
    const candidates = [resumed];
    for (let i = 0; i < 40 && !same && !candidates.some((c) => c.job_id === job.job_id); i++) {
      const c = await claimFor(env.ctx, worker(`n${i}`));
      if (c) candidates.push(c);
    }
    const found = candidates.find((c) => c.job_id === job.job_id);
    expect(found?.checkpoint).toEqual(state);
  });

  it("rejects oversized checkpoints", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const w = worker("big");
    const job = (await claimFor(env.ctx, w))!;
    await expect(
      checkpointJob(env.ctx, {
        jobId: job.job_id,
        workerId: w,
        token: job.lease_token,
        checkpoint: { blob: "x".repeat(70_000) },
        nodes: 1,
      }),
    ).rejects.toMatchObject({ code: "checkpoint_too_large" });
  });

  it("release returns the job to the pool immediately", async () => {
    await seedNQueens(env.ctx, 4, 1);
    const w = worker("rel");
    const job = (await claimFor(env.ctx, w))!;
    await releaseJob(env.ctx, { jobId: job.job_id, workerId: w, token: job.lease_token });
    expect((await status(job.job_id)).status).toBe("pending");
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: w,
        token: job.lease_token,
        result: { solutions: 0 },
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toMatchObject({ code: "lease_released" });
  });

  it("fails jobs that exhaust their attempts instead of retrying forever", async () => {
    await seedNQueens(env.ctx, 4, 4); // 2 jobs
    await env.db.execute("UPDATE problems SET max_attempts = 2 WHERE problem = 'nqueens'");
    for (let round = 0; round < 3; round++) {
      while (await claimFor(env.ctx, worker(`r${round}`))) {
        /* lease everything */
      }
      env.clock.now += 901_000;
    }
    await maintenance(env.ctx, true);
    const failed = await env.db.execute("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed'");
    expect(Number(failed.rows[0].n)).toBeGreaterThan(0);
    expect(await claimFor(env.ctx, worker("after"))).toBeNull();
  });
});

describe("submission and verification", () => {
  it("keeps a single submission unverified (SUBMITTED, not VERIFIED)", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const w = worker("a");
    const job = (await claimFor(env.ctx, w))!;
    const outcome = await submitHonest(env.ctx, job, w);
    expect(outcome).toMatchObject({ status: "submitted", accepted: true, duplicate: false });
    const row = await env.db.execute({
      sql: "SELECT verified_result_hash FROM jobs WHERE job_id = ?",
      args: [job.job_id],
    });
    expect(row.rows[0].verified_result_hash).toBeNull();
  });

  it("verifies when two independent workers agree, and records provenance", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const a = worker("a"),
      b = worker("b");
    const first = (await claimFor(env.ctx, a))!;
    await submitHonest(env.ctx, first, a);
    const second = (await claimFor(env.ctx, b))!;
    expect(second.job_id).toBe(first.job_id);
    const outcome = await submitHonest(env.ctx, second, b);
    expect(outcome.status).toBe("verified");
    const subs = await env.db.execute({
      sql: "SELECT status FROM submissions WHERE job_id = ?",
      args: [first.job_id],
    });
    expect(subs.rows.map((r) => String(r.status))).toEqual(["verified", "verified"]);
    const v = await env.db.execute({
      sql: "SELECT outcome, method FROM verifications WHERE job_id = ?",
      args: [first.job_id],
    });
    expect(v.rows.map((r) => `${String(r.outcome)}/${String(r.method)}`)).toEqual([
      "verified/redundant-match",
    ]);
  });

  it("does not count a duplicate submission twice and is idempotent on replay", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const a = worker("a");
    const job = (await claimFor(env.ctx, a))!;
    const first = await submitHonest(env.ctx, job, a);
    const replay = await submitHonest(env.ctx, job, a);
    expect(replay.duplicate).toBe(true);
    expect(replay.status).toBe(first.status);
    expect(replay.status).toBe("submitted");
    const n = await env.db.execute({
      sql: "SELECT COUNT(*) AS n FROM submissions WHERE job_id = ?",
      args: [job.job_id],
    });
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it("rejects a worker who resubmits a different result", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const a = worker("a");
    const job = (await claimFor(env.ctx, a))!;
    const { result } = await compute(job.payload);
    await submitResult(env.ctx, {
      jobId: job.job_id,
      workerId: a,
      token: job.lease_token,
      result,
      nodes: 1,
      runtimeMs: 1,
      networkHash: null,
    });
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: a,
        token: job.lease_token,
        result: { solutions: result.solutions + 1 },
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toMatchObject({ code: "conflicting_resubmission" });
  });

  it("marks disagreement DISPUTED, then resolves with a third independent worker", async () => {
    await seedNQueens(env.ctx, 6, 1);
    const [a, b, c] = [worker("a"), worker("b"), worker("c")];
    const job = (await claimFor(env.ctx, a))!;
    const { result } = await compute(job.payload);
    await submitResult(env.ctx, {
      jobId: job.job_id,
      workerId: a,
      token: job.lease_token,
      result: { solutions: result.solutions + 1 },
      nodes: 1,
      runtimeMs: 1,
      networkHash: null,
    }); // cheater
    const second = (await claimFor(env.ctx, b))!;
    expect(second.job_id).toBe(job.job_id);
    expect((await submitHonest(env.ctx, second, b)).status).toBe("disputed");
    expect(String((await status(job.job_id)).status)).toBe("disputed");
    const third = (await claimFor(env.ctx, c))!;
    expect(third.job_id).toBe(job.job_id);
    expect((await submitHonest(env.ctx, third, c)).status).toBe("verified");
    const final = await env.db.execute({
      sql: "SELECT verified_result FROM jobs WHERE job_id = ?",
      args: [job.job_id],
    });
    expect(JSON.parse(String(final.rows[0].verified_result))).toEqual(result);
    const rejected = await env.db.execute({
      sql: "SELECT worker_id FROM submissions WHERE job_id = ? AND status = 'rejected'",
      args: [job.job_id],
    });
    expect(rejected.rows.map((r) => String(r.worker_id))).toEqual([a]);
  });

  it("lets a trusted verifier settle a dispute and reopen a bad verification", async () => {
    await seedNQueens(env.ctx, 6, 1);
    const [a, b] = [worker("a"), worker("b")];
    const job = (await claimFor(env.ctx, a))!;
    const { result } = await compute(job.payload);
    const wrong = { solutions: result.solutions + 5 };
    await submitResult(env.ctx, {
      jobId: job.job_id,
      workerId: a,
      token: job.lease_token,
      result: wrong,
      nodes: 1,
      runtimeMs: 1,
      networkHash: null,
    });
    const second = (await claimFor(env.ctx, b))!;
    await submitResult(env.ctx, {
      jobId: job.job_id,
      workerId: b,
      token: second.lease_token,
      result: wrong,
      nodes: 1,
      runtimeMs: 1,
      networkHash: null,
    }); // colluding workers verify a wrong value
    expect(String((await status(job.job_id)).status)).toBe("verified");
    const audit = await submitResult(env.ctx, {
      jobId: job.job_id,
      workerId: "trusted:native",
      token: null,
      trusted: true,
      method: "trusted-native",
      result,
      nodes: 5,
      runtimeMs: 1,
      networkHash: null,
    });
    expect(audit.status).toBe("verified");
    const final = await env.db.execute({
      sql: "SELECT verified_result FROM jobs WHERE job_id = ?",
      args: [job.job_id],
    });
    expect(JSON.parse(String(final.rows[0].verified_result))).toEqual(result);
    const outcomes = await env.db.execute({
      sql: "SELECT outcome FROM verifications WHERE job_id = ? ORDER BY created_at",
      args: [job.job_id],
    });
    expect(outcomes.rows.map((r) => String(r.outcome))).toContain("reopened");
  });

  it("validates result structure and the optional client hash", async () => {
    await seedNQueens(env.ctx, 5, 1);
    const a = worker("a");
    const job = (await claimFor(env.ctx, a))!;
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: a,
        token: job.lease_token,
        result: { solutions: "many" },
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toThrow(/solutions/);
    await expect(
      submitResult(env.ctx, {
        jobId: job.job_id,
        workerId: a,
        token: job.lease_token,
        result: { solutions: 1 },
        clientHash: "0".repeat(64),
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    await expect(
      submitResult(env.ctx, {
        jobId: "f".repeat(64),
        workerId: a,
        token: job.lease_token,
        result: { solutions: 1 },
        nodes: 1,
        runtimeMs: 1,
        networkHash: null,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses to count two workers from the same network when distinct networks are required", async () => {
    const strict = await freshEnv({ distinctNetworks: true });
    try {
      await seedNQueens(strict.ctx, 5, 1);
      const [a, b, c] = [worker("a"), worker("b"), worker("c")];
      const job = (await claimFor(strict.ctx, a))!;
      await submitHonest(strict.ctx, job, a, "netA");
      const second = (await claimFor(strict.ctx, b))!;
      expect((await submitHonest(strict.ctx, second, b, "netA")).status).toBe("submitted");
      const third = (await claimFor(strict.ctx, c))!;
      expect((await submitHonest(strict.ctx, third, c, "netB")).status).toBe("verified");
    } finally {
      strict.cleanup();
    }
  });
});

describe("aggregation and browsing", () => {
  it("sums verified jobs into the exact known solution count", async () => {
    const run = await seedNQueens(env.ctx, 8, 2);
    const [a, b] = [worker("a"), worker("b")];
    for (const w of [a, b])
      for (let i = 0; i < run.totalJobs; i++) {
        const job = await claimFor(env.ctx, w);
        if (!job) break;
        await submitHonest(env.ctx, job, w);
      }
    const aggregate = await recomputeAggregate(env.ctx, run.runId);
    expect(aggregate).toMatchObject({
      solutions: 92,
      verified_jobs: run.totalJobs,
      total_jobs: run.totalJobs,
    });
    const row = await env.db.execute({
      sql: "SELECT complete FROM aggregate_results WHERE run_id = ?",
      args: [run.runId],
    });
    expect(Number(row.rows[0].complete)).toBe(1);
    expect(
      String(
        (await env.db.execute({ sql: "SELECT status FROM runs WHERE run_id = ?", args: [run.runId] })).rows[0]
          .status,
      ),
    ).toBe("complete");
  });

  it("filters the job browser with bound parameters only", async () => {
    const run = await seedNQueens(env.ctx, 6, 2);
    const all = await listJobs(env.db, { limit: 5, offset: 0 });
    expect(all.total).toBe(run.totalJobs);
    expect(all.jobs).toHaveLength(Math.min(5, run.totalJobs));
    const none = await listJobs(env.db, { limit: 5, offset: 0, status: "verified" });
    expect(none.total).toBe(0);
    const injected = await listJobs(env.db, { limit: 5, offset: 0, runId: "x' OR '1'='1" });
    expect(injected.total).toBe(0);
    const table = await env.db.execute("SELECT name FROM sqlite_master WHERE name = 'jobs'");
    expect(table.rows).toHaveLength(1);
  });
});
