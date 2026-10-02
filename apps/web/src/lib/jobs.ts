import { randomBytes, randomUUID } from "node:crypto";
import type { Client, InStatement, Transaction } from "@libsql/client";
import { canonicalJson, jobIdOf, resultHashOf, sha256Hex } from "./canonical";
import { decide, type PolicySubmission } from "./policy";
import { ApiError } from "./http";
import { validateJobDefinition, validateResult, type JobDefinition, type Obj } from "./validate";

export interface Ctx {
  db: Client;
  now: () => number;
  requireDistinctNetworks: boolean;
}

type Executor = Pick<Client, "execute">;

export const ENGINE_VERSION = "forge-engine/1";
const CHECKPOINT_MAX_BYTES = 64 * 1024;
const PLATFORM = /^[A-Za-z0-9_.:/ -]{1,64}$/;

const str = (v: unknown): string => String(v);
const num = (v: unknown): number => Number(v);

const isBusy = (error: unknown): boolean => {
  const text = error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message}` : "";
  return /SQLITE_BUSY|SQLITE_LOCKED|TRANSACTION_ACTIVE|database is locked|database table is locked/i.test(
    text,
  );
};

/** Retries on writer contention with jittered backoff; callers' bodies are rolled back first, so re-running is safe. */
export async function withRetry<T>(operation: () => Promise<T>, attempts = 25): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isBusy(error) || attempt >= attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(120, 4 * 2 ** attempt) * (0.5 + Math.random())),
      );
    }
  }
}

const embeddedQueues = new WeakMap<Client, Promise<unknown>>();

/**
 * Runs `task` after any earlier task on the same embedded (file:) client. The embedded driver cannot
 * recover a pooled connection after a failed BEGIN, so a single process never contends with itself.
 * Remote databases (Turso) serialize writers server-side and run concurrently.
 */
function serialized<T>(db: Client, task: () => Promise<T>): Promise<T> {
  if (db.protocol !== "file") return task();
  const previous = embeddedQueues.get(db) ?? Promise.resolve();
  const next = previous.then(task, task);
  embeddedQueues.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

async function inTransaction<T>(db: Client, body: (tx: Transaction) => Promise<T>): Promise<T> {
  return serialized(db, () =>
    withRetry(async () => {
      const tx = await db.transaction("write");
      try {
        const value = await body(tx);
        await tx.commit();
        return value;
      } catch (error) {
        await tx.rollback().catch(() => undefined);
        throw error;
      } finally {
        tx.close();
      }
    }),
  );
}

const batchWrite = (db: Client, statements: InStatement[]) =>
  serialized(db, () => withRetry(() => db.batch(statements, "write")));

export function runIdOf(problem: string, solverVersion: string, parameters: Obj): string {
  return jobIdOf({ parameters, problem, solver_version: solverVersion }).slice(0, 24);
}

/** Creates (or idempotently extends) a run and its deterministic jobs. Job ids come from the definition itself. */
export async function createRun(
  ctx: Ctx,
  problem: string,
  parameters: Obj,
  definitions: unknown[],
  priority = 0,
): Promise<{ runId: string; totalJobs: number; inserted: number }> {
  const defs: JobDefinition[] = definitions.map(validateJobDefinition);
  if (defs.length === 0) throw new ApiError(400, "empty_run", "a run needs at least one job");
  const solver = defs[0].solver_version;
  if (defs.some((d) => d.problem !== problem || d.solver_version !== solver))
    throw new ApiError(400, "mixed_run", "all jobs of a run must share problem and solver");
  const runId = runIdOf(problem, solver, parameters);
  const now = ctx.now();
  await batchWrite(ctx.db, [
    {
      sql: "INSERT OR IGNORE INTO solver_versions (problem, solver_version, engine_version, platform, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [problem, solver, ENGINE_VERSION, "wasm+native", now],
    },
    {
      sql: "INSERT OR IGNORE INTO runs (run_id, problem, solver_version, parameters, total_jobs, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      args: [runId, problem, solver, canonicalJson(parameters), now],
    },
  ]);
  let inserted = 0;
  for (let start = 0; start < defs.length; start += 200) {
    const statements: InStatement[] = defs.slice(start, start + 200).map((def) => ({
      sql: "INSERT OR IGNORE INTO jobs (job_id, run_id, problem, problem_version, solver_version, payload, status, priority, created_at, updated_at) VALUES (?, ?, ?, '1', ?, ?, 'pending', ?, ?, ?)",
      args: [jobIdOf(def), runId, problem, solver, canonicalJson(def), priority, now, now],
    }));
    const results = await batchWrite(ctx.db, statements);
    inserted += results.reduce((n, r) => n + r.rowsAffected, 0);
  }
  await ctx.db.execute({
    sql: "UPDATE runs SET total_jobs = (SELECT COUNT(*) FROM jobs WHERE run_id = ?) WHERE run_id = ?",
    args: [runId, runId],
  });
  return { runId, totalJobs: defs.length, inserted };
}

export interface ClaimedJob {
  job_id: string;
  run_id: string;
  payload: JobDefinition;
  checkpoint: Obj | null;
  lease_token: string;
  lease_until: number;
  required_matches: number;
}

export async function leaseSeconds(db: Executor, problem: string): Promise<number> {
  const r = await db.execute({
    sql: "SELECT lease_seconds FROM problems WHERE problem = ?",
    args: [problem],
  });
  if (r.rows.length === 0) throw new ApiError(404, "unknown_problem", "unknown problem");
  return num(r.rows[0].lease_seconds);
}

let lastMaintenance = 0;

/** Retires expired leases and fails jobs that exhausted their attempts. Cheap; throttled per instance. */
export async function maintenance(ctx: Ctx, force = false): Promise<void> {
  const now = ctx.now();
  if (!force && now - lastMaintenance < 30_000) return;
  lastMaintenance = now;
  await batchWrite(ctx.db, [
    {
      sql: "UPDATE job_leases SET outcome = 'expired' WHERE outcome IS NULL AND lease_until < ?",
      args: [now],
    },
    {
      sql: `UPDATE jobs SET status = 'failed', lease_owner = NULL, lease_until = NULL, updated_at = ?
              WHERE status IN ('pending', 'submitted', 'disputed', 'leased', 'running')
                AND attempts >= (SELECT max_attempts FROM problems p WHERE p.problem = jobs.problem)
                AND (lease_until IS NULL OR lease_until < ?)`,
      args: [now, now],
    },
  ]);
}

/**
 * Atomically leases one job. The selection and the update are a single statement, so two concurrent
 * workers can never receive the same job; a worker never receives a job it already submitted.
 */
export async function claimJob(
  ctx: Ctx,
  input: { workerId: string; problem: string; runId?: string | null; platform?: string | null },
): Promise<ClaimedJob | null> {
  await maintenance(ctx);
  const seconds = await leaseSeconds(ctx.db, input.problem);
  const now = ctx.now();
  const until = now + seconds * 1000;
  const token = randomBytes(32).toString("base64url");
  return inTransaction(ctx.db, async (tx) => {
    const claimed = await tx.execute({
      sql: `UPDATE jobs SET status = 'leased', lease_owner = ?1, lease_until = ?2, attempts = attempts + 1, updated_at = ?3
            WHERE job_id = (
              SELECT j.job_id FROM jobs j JOIN problems p ON p.problem = j.problem
              WHERE j.problem = ?4 AND (?5 IS NULL OR j.run_id = ?5)
                AND (j.status IN ('pending', 'submitted', 'disputed') OR (j.status IN ('leased', 'running') AND j.lease_until < ?3))
                AND j.attempts < p.max_attempts
                AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.job_id = j.job_id AND s.worker_id = ?1)
              ORDER BY (j.verification_count > 0) DESC, j.priority DESC, j.created_at, j.job_id
              LIMIT 1)
            RETURNING job_id, run_id, payload, checkpoint`,
      args: [input.workerId, until, now, input.problem, input.runId ?? null],
    });
    if (claimed.rows.length === 0) return null;
    const row = claimed.rows[0];
    await tx.execute({
      sql: "UPDATE job_leases SET outcome = 'expired' WHERE job_id = ? AND outcome IS NULL",
      args: [str(row.job_id)],
    });
    await tx.execute({
      sql: "INSERT INTO job_leases (lease_id, job_id, worker_id, token_hash, leased_at, lease_until) VALUES (?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), str(row.job_id), input.workerId, sha256Hex(token), now, until],
    });
    const required = await tx.execute({
      sql: "SELECT required_matches FROM problems WHERE problem = ?",
      args: [input.problem],
    });
    return {
      job_id: str(row.job_id),
      run_id: str(row.run_id),
      payload: JSON.parse(str(row.payload)) as JobDefinition,
      checkpoint: row.checkpoint ? (JSON.parse(str(row.checkpoint)) as Obj) : null,
      lease_token: token,
      lease_until: until,
      required_matches: num(required.rows[0].required_matches),
    };
  });
}

interface LeaseRow {
  leaseId: string;
  leaseUntil: number;
  outcome: string | null;
}

async function findLease(
  db: Executor,
  jobId: string,
  workerId: string,
  token: string,
): Promise<LeaseRow | null> {
  const r = await db.execute({
    sql: "SELECT lease_id, lease_until, outcome FROM job_leases WHERE job_id = ? AND worker_id = ? AND token_hash = ? ORDER BY leased_at DESC LIMIT 1",
    args: [jobId, workerId, sha256Hex(token)],
  });
  if (r.rows.length === 0) return null;
  return {
    leaseId: str(r.rows[0].lease_id),
    leaseUntil: num(r.rows[0].lease_until),
    outcome: r.rows[0].outcome === null ? null : str(r.rows[0].outcome),
  };
}

export async function checkpointJob(
  ctx: Ctx,
  input: { jobId: string; workerId: string; token: string; checkpoint: Obj; nodes: number },
): Promise<{ lease_until: number }> {
  const text = canonicalJson(input.checkpoint);
  if (text.length > CHECKPOINT_MAX_BYTES)
    throw new ApiError(413, "checkpoint_too_large", "checkpoint exceeds 64 KiB");
  const lease = await findLease(ctx.db, input.jobId, input.workerId, input.token);
  const now = ctx.now();
  if (!lease) throw new ApiError(403, "lease_invalid", "no such lease");
  if (lease.outcome !== null || lease.leaseUntil < now)
    throw new ApiError(409, "lease_lost", "the lease expired or was released");
  const job = await ctx.db.execute({
    sql: "SELECT problem, lease_owner FROM jobs WHERE job_id = ?",
    args: [input.jobId],
  });
  if (job.rows.length === 0 || str(job.rows[0].lease_owner) !== input.workerId)
    throw new ApiError(409, "lease_lost", "the job is leased to another worker");
  const until = now + (await leaseSeconds(ctx.db, str(job.rows[0].problem))) * 1000;
  await batchWrite(ctx.db, [
    {
      sql: "UPDATE jobs SET status = 'running', checkpoint = ?, checkpoint_at = ?, nodes_processed = ?, lease_until = ?, updated_at = ? WHERE job_id = ? AND lease_owner = ?",
      args: [text, now, input.nodes, until, now, input.jobId, input.workerId],
    },
    { sql: "UPDATE job_leases SET lease_until = ? WHERE lease_id = ?", args: [until, lease.leaseId] },
  ]);
  return { lease_until: until };
}

export async function releaseJob(
  ctx: Ctx,
  input: { jobId: string; workerId: string; token: string },
): Promise<void> {
  const lease = await findLease(ctx.db, input.jobId, input.workerId, input.token);
  if (!lease) throw new ApiError(403, "lease_invalid", "no such lease");
  if (lease.outcome !== null) return;
  const now = ctx.now();
  await batchWrite(ctx.db, [
    {
      sql: "UPDATE job_leases SET outcome = 'released', released_at = ? WHERE lease_id = ?",
      args: [now, lease.leaseId],
    },
    {
      sql: `UPDATE jobs SET status = CASE WHEN verification_count > 0 THEN 'submitted' ELSE 'pending' END, lease_owner = NULL, lease_until = NULL, updated_at = ?
              WHERE job_id = ? AND lease_owner = ? AND status IN ('leased', 'running')`,
      args: [now, input.jobId, input.workerId],
    },
  ]);
}

export interface SubmitInput {
  jobId: string;
  workerId: string;
  token: string | null;
  trusted?: boolean;
  method?: string;
  result: unknown;
  clientHash?: string | null;
  nodes: number;
  runtimeMs: number;
  platform?: string | null;
  networkHash: string | null;
}

export interface SubmitOutcome {
  status: string;
  accepted: boolean;
  duplicate: boolean;
  verification_count: number;
  reason?: string;
}

async function loadSubmissions(
  db: Executor,
  jobId: string,
): Promise<(PolicySubmission & { result: string })[]> {
  const r = await db.execute({
    sql: "SELECT submission_id, worker_id, network_hash, result_hash, result, trusted FROM submissions WHERE job_id = ? AND status != 'rejected' ORDER BY created_at, submission_id",
    args: [jobId],
  });
  return r.rows.map((row) => ({
    id: str(row.submission_id),
    workerId: str(row.worker_id),
    networkHash: row.network_hash === null ? null : str(row.network_hash),
    hash: str(row.result_hash),
    trusted: num(row.trusted) === 1,
    result: str(row.result),
  }));
}

/** Re-derives a job's state from its submissions inside the caller's transaction. Returns the new status. */
async function reevaluate(
  ctx: Ctx,
  tx: Executor,
  jobId: string,
  method: string,
): Promise<{ status: string; verifiedNow: boolean; bestGroup: number }> {
  const job = await tx.execute({
    sql: "SELECT j.problem, j.status, j.verified_result_hash, p.required_matches FROM jobs j JOIN problems p ON p.problem = j.problem WHERE j.job_id = ?",
    args: [jobId],
  });
  const row = job.rows[0];
  const previousStatus = str(row.status);
  const previousHash = row.verified_result_hash === null ? null : str(row.verified_result_hash);
  const subs = await loadSubmissions(tx, jobId);
  const verdict = decide(num(row.required_matches), subs, ctx.requireDistinctNetworks);
  const now = ctx.now();
  if (verdict.status === "verified" && verdict.hash) {
    const winner = subs.find((s) => s.hash === verdict.hash)!;
    await tx.execute({
      sql: "UPDATE jobs SET status = 'verified', verified_result_hash = ?1, verified_result = ?2, submitted_result_hash = ?1, verification_count = ?3, lease_owner = NULL, lease_until = NULL, checkpoint = NULL, updated_at = ?4 WHERE job_id = ?5",
      args: [verdict.hash, winner.result, verdict.bestGroup, now, jobId],
    });
    await tx.execute({
      sql: "UPDATE submissions SET status = CASE WHEN result_hash = ? THEN 'verified' ELSE 'rejected' END WHERE job_id = ?",
      args: [verdict.hash, jobId],
    });
    await tx.execute({
      sql: "UPDATE job_leases SET outcome = COALESCE(outcome, 'expired') WHERE job_id = ?",
      args: [jobId],
    });
  } else {
    await tx.execute({
      sql: "UPDATE jobs SET status = ?1, submitted_result_hash = ?2, verified_result_hash = NULL, verified_result = NULL, verification_count = ?3, lease_owner = NULL, lease_until = NULL, updated_at = ?4 WHERE job_id = ?5",
      args: [verdict.status, subs.at(-1)?.hash ?? null, verdict.bestGroup, now, jobId],
    });
  }
  const changed =
    verdict.status !== previousStatus || (verdict.hash !== null && verdict.hash !== previousHash);
  if (changed && verdict.status !== "submitted") {
    const reopened = previousStatus === "verified" && verdict.hash !== previousHash;
    await tx.execute({
      sql: "INSERT INTO verifications (verification_id, job_id, outcome, result_hash, submission_ids, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        randomUUID(),
        jobId,
        reopened ? "reopened" : verdict.status,
        verdict.hash,
        subs.map((s) => s.id).join(","),
        reopened ? "audit-mismatch" : method,
        now,
      ],
    });
  }
  return {
    status: verdict.status,
    verifiedNow: verdict.status === "verified" && previousStatus !== "verified",
    bestGroup: verdict.bestGroup,
  };
}

export async function submitResult(ctx: Ctx, input: SubmitInput): Promise<SubmitOutcome> {
  const job = await ctx.db.execute({
    sql: "SELECT job_id, run_id, payload, status FROM jobs WHERE job_id = ?",
    args: [input.jobId],
  });
  if (job.rows.length === 0) throw new ApiError(404, "unknown_job", "unknown job");
  const def = JSON.parse(str(job.rows[0].payload)) as JobDefinition;
  const runId = str(job.rows[0].run_id);
  const status = str(job.rows[0].status);

  if (!input.trusted) {
    if (!input.token) throw new ApiError(403, "lease_invalid", "a lease token is required");
    const lease = await findLease(ctx.db, input.jobId, input.workerId, input.token);
    if (!lease) throw new ApiError(403, "lease_invalid", "no such lease");
    if (lease.outcome === "released") throw new ApiError(409, "lease_released", "the lease was released");
  }
  const result = validateResult(def, input.result);
  const hash = resultHashOf(result);
  if (input.clientHash && input.clientHash !== hash)
    throw new ApiError(400, "hash_mismatch", "result_hash does not match the result");
  if (status === "cancelled" || status === "failed")
    throw new ApiError(409, "job_closed", `job is ${status}`);

  const outcome = await inTransaction(ctx.db, async (tx) => {
    const existing = await tx.execute({
      sql: "SELECT result_hash FROM submissions WHERE job_id = ? AND worker_id = ?",
      args: [input.jobId, input.workerId],
    });
    if (existing.rows.length > 0) {
      if (str(existing.rows[0].result_hash) !== hash)
        throw new ApiError(
          409,
          "conflicting_resubmission",
          "this worker already submitted a different result",
        );
      const current = await tx.execute({
        sql: "SELECT status, verification_count FROM jobs WHERE job_id = ?",
        args: [input.jobId],
      });
      return {
        status: str(current.rows[0].status),
        accepted: true,
        duplicate: true,
        verification_count: num(current.rows[0].verification_count),
        verifiedNow: false,
      };
    }
    if (!input.trusted && status === "verified") {
      const current = await tx.execute({
        sql: "SELECT verification_count FROM jobs WHERE job_id = ?",
        args: [input.jobId],
      });
      return {
        status: "verified",
        accepted: false,
        duplicate: false,
        verification_count: num(current.rows[0].verification_count),
        verifiedNow: false,
        reason: "job_already_verified",
      };
    }
    const now = ctx.now();
    const platform = input.platform && PLATFORM.test(input.platform) ? input.platform : null;
    await tx.execute({
      sql: "INSERT INTO submissions (submission_id, job_id, worker_id, network_hash, result_hash, result, nodes_processed, runtime_ms, platform, trusted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        randomUUID(),
        input.jobId,
        input.workerId,
        input.networkHash,
        hash,
        canonicalJson(result),
        input.nodes,
        input.runtimeMs,
        platform,
        input.trusted ? 1 : 0,
        now,
      ],
    });
    await tx.execute({
      sql: "UPDATE job_leases SET outcome = 'submitted', released_at = ? WHERE job_id = ? AND worker_id = ? AND outcome IS NULL",
      args: [now, input.jobId, input.workerId],
    });
    await tx.execute({
      sql: "UPDATE jobs SET nodes_processed = ?, runtime_ms = ?, platform = ?, updated_at = ? WHERE job_id = ?",
      args: [input.nodes, input.runtimeMs, platform, now, input.jobId],
    });
    const verdict = await reevaluate(
      ctx,
      tx,
      input.jobId,
      input.trusted ? (input.method ?? "trusted-recompute") : "redundant-match",
    );
    return {
      status: verdict.status,
      accepted: true,
      duplicate: false,
      verification_count: verdict.bestGroup,
      verifiedNow: verdict.verifiedNow,
    };
  });
  if (outcome.verifiedNow) await recomputeAggregate(ctx, runId);
  const { verifiedNow, ...visible } = outcome;
  void verifiedNow;
  return visible;
}

/** Sums verified job results of a run into its aggregate; complete only when every job is verified. */
export async function recomputeAggregate(ctx: Ctx, runId: string): Promise<Obj> {
  const run = await ctx.db.execute({
    sql: "SELECT problem, parameters FROM runs WHERE run_id = ?",
    args: [runId],
  });
  if (run.rows.length === 0) throw new ApiError(404, "unknown_run", "unknown run");
  const problem = str(run.rows[0].problem);
  const jobs = await ctx.db.execute({
    sql: "SELECT status, verified_result FROM jobs WHERE run_id = ?",
    args: [runId],
  });
  let solutions = 0;
  const perft = { captures: 0, castles: 0, en_passant: 0, nodes: 0, promotions: 0 };
  let verified = 0;
  for (const job of jobs.rows) {
    if (str(job.status) !== "verified" || job.verified_result === null) continue;
    verified++;
    const result = JSON.parse(str(job.verified_result)) as Record<string, number>;
    if (problem === "nqueens") solutions += result.solutions;
    else for (const key of Object.keys(perft) as (keyof typeof perft)[]) perft[key] += result[key];
  }
  const total = jobs.rows.length;
  const aggregate: Obj = {
    parameters: JSON.parse(str(run.rows[0].parameters)),
    problem,
    total_jobs: total,
    verified_jobs: verified,
    ...(problem === "nqueens" ? { solutions } : { perft }),
  };
  const text = canonicalJson(aggregate);
  const complete = total > 0 && verified === total ? 1 : 0;
  const now = ctx.now();
  await batchWrite(ctx.db, [
    {
      sql: `INSERT INTO aggregate_results (run_id, result, result_hash, verified_jobs, total_jobs, complete, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
              ON CONFLICT(run_id) DO UPDATE SET result = ?2, result_hash = ?3, verified_jobs = ?4, total_jobs = ?5, complete = ?6, updated_at = ?7`,
      args: [runId, text, sha256Hex(text), verified, total, complete, now],
    },
    {
      sql: "UPDATE runs SET status = CASE WHEN ?1 = 1 THEN 'complete' ELSE status END, completed_at = CASE WHEN ?1 = 1 THEN ?2 ELSE completed_at END WHERE run_id = ?3",
      args: [complete, now, runId],
    },
  ]);
  return aggregate;
}

export interface JobFilters {
  problem?: string;
  runId?: string;
  solverVersion?: string;
  status?: string;
  depth?: number;
  resultHash?: string;
  jobId?: string;
  limit: number;
  offset: number;
}

export const JOB_STATUSES = [
  "pending",
  "leased",
  "running",
  "submitted",
  "verified",
  "disputed",
  "failed",
  "cancelled",
] as const;

/** Filtered, paginated job browser. Every filter is a bound parameter; no SQL is ever accepted from clients. */
export async function listJobs(db: Executor, f: JobFilters) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (clause: string, value: string | number | undefined) => {
    if (value === undefined) return;
    where.push(clause);
    args.push(value);
  };
  add("problem = ?", f.problem);
  add("run_id = ?", f.runId);
  add("solver_version = ?", f.solverVersion);
  add("status = ?", f.status);
  add("json_extract(payload, '$.depth') = ?", f.depth);
  add("verified_result_hash = ?", f.resultHash);
  add("job_id = ?", f.jobId);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db.execute({ sql: `SELECT COUNT(*) AS n FROM jobs ${clause}`, args });
  const rows = await db.execute({
    sql: `SELECT job_id, run_id, problem, solver_version, status, attempts, nodes_processed, runtime_ms, platform, verification_count,
                 verified_result_hash, verified_result, json_extract(payload, '$.depth') AS depth, payload, updated_at
          FROM jobs ${clause} ORDER BY job_id LIMIT ? OFFSET ?`,
    args: [...args, f.limit, f.offset],
  });
  return {
    total: num(total.rows[0].n),
    jobs: rows.rows.map((r) => ({
      job_id: str(r.job_id),
      run_id: str(r.run_id),
      problem: str(r.problem),
      solver_version: str(r.solver_version),
      status: str(r.status),
      attempts: num(r.attempts),
      nodes_processed: num(r.nodes_processed),
      runtime_ms: num(r.runtime_ms),
      platform: r.platform === null ? null : str(r.platform),
      verification_count: num(r.verification_count),
      verified_result_hash: r.verified_result_hash === null ? null : str(r.verified_result_hash),
      verified_result: r.verified_result === null ? null : (JSON.parse(str(r.verified_result)) as Obj),
      depth: r.depth === null ? null : num(r.depth),
      payload: JSON.parse(str(r.payload)) as Obj,
      updated_at: num(r.updated_at),
    })),
  };
}

export async function jobStats(db: Executor) {
  const byStatus = await db.execute(
    "SELECT problem, status, COUNT(*) AS jobs, COALESCE(SUM(nodes_processed), 0) AS nodes FROM jobs GROUP BY problem, status ORDER BY problem, status",
  );
  const runs = await db.execute(
    `SELECT r.run_id, r.problem, r.solver_version, r.status, r.parameters, r.total_jobs, r.created_at, a.verified_jobs, a.complete, a.result
     FROM runs r LEFT JOIN aggregate_results a ON a.run_id = r.run_id ORDER BY r.created_at DESC LIMIT 100`,
  );
  const workers = await db.execute(
    "SELECT COUNT(DISTINCT worker_id) AS n FROM submissions WHERE trusted = 0",
  );
  return {
    by_status: byStatus.rows.map((r) => ({
      problem: str(r.problem),
      status: str(r.status),
      jobs: num(r.jobs),
      nodes: num(r.nodes),
    })),
    runs: runs.rows.map((r) => ({
      run_id: str(r.run_id),
      problem: str(r.problem),
      solver_version: str(r.solver_version),
      status: str(r.status),
      parameters: JSON.parse(str(r.parameters)) as Obj,
      total_jobs: num(r.total_jobs),
      created_at: num(r.created_at),
      verified_jobs: r.verified_jobs === null ? 0 : num(r.verified_jobs),
      complete: r.complete === null ? false : num(r.complete) === 1,
      aggregate: r.result === null ? null : (JSON.parse(str(r.result)) as Obj),
    })),
    contributing_workers: num(workers.rows[0].n),
  };
}
