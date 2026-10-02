import { dutyCycle } from "./capabilities";
import type { EngineHandle } from "./engine-client";
import type { ClaimStore, StoredClaim } from "./store";

export const ENGINE_VERSION = "forge-engine/1";

export type ComputeStatus = "idle" | "running" | "paused" | "stopped" | "error";

export interface ComputeSnapshot {
  status: ComputeStatus;
  workers: number;
  current: { job_id: string; progress_permille: number }[];
  jobsCompleted: number;
  nodesProcessed: number;
  runtimeMs: number;
  message: string;
}

export interface ControllerDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  store: ClaimStore;
  spawn: () => EngineHandle;
  workerId: string;
  problem: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Fixed node budget per step; when unset the budget adapts to roughly 120 ms per step. */
  fixedBudget?: number;
  /** How often progress is written to IndexedDB (default 1 s) and checkpointed to the server (default 15 s). */
  saveIntervalMs?: number;
  checkpointIntervalMs?: number;
}

export interface ControllerOptions {
  workers: number;
  intensity: number;
}

interface StepReply {
  done: boolean;
  state: Record<string, unknown>;
  progress_permille: number;
  nodes: number;
  result: Record<string, unknown> | null;
}

class Stopped extends Error {}

/**
 * Orchestrates browser contribution: claim -> compute in a WebAssembly worker -> checkpoint -> submit.
 * Nothing runs until start() is called by an explicit user action. Progress is persisted to IndexedDB
 * so a closed tab can resume where it stopped.
 */
export class ComputeController {
  private status: ComputeStatus = "idle";
  private engines: EngineHandle[] = [];
  private slots: Promise<void>[] = [];
  private active = new Map<string, StoredClaim>();
  private settledClaims = new WeakSet<StoredClaim>();
  private resumeQueue: StoredClaim[] = [];
  private listeners = new Set<(s: ComputeSnapshot) => void>();
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;
  private wake: (() => void)[] = [];
  private jobsCompleted = 0;
  private nodesProcessed = 0;
  private runtimeMs = 0;
  private runningSince = 0;
  private message = "";
  private budget: number;
  private readonly now: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private deps: ControllerDeps,
    private options: ControllerOptions,
  ) {
    this.now = deps.now ?? Date.now;
    this.budget = deps.fixedBudget ?? 100_000;
    this.sleepFn = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  subscribe(listener: (s: ComputeSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ComputeSnapshot {
    const running = this.status === "running" ? this.now() - this.runningSince : 0;
    return {
      status: this.status,
      workers: this.engines.length,
      current: [...this.active.values()].map((c) => ({
        job_id: c.job_id,
        progress_permille: c.progress_permille,
      })),
      jobsCompleted: this.jobsCompleted,
      nodesProcessed: this.nodesProcessed,
      runtimeMs: this.runtimeMs + running,
      message: this.message,
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
  }

  /** Explicit user action. Claims saved by an earlier session are finished first. */
  start(resume: StoredClaim[] = []): void {
    if (this.status === "running") return;
    this.resumeQueue = [...resume];
    this.status = "running";
    this.runningSince = this.now();
    this.message = "";
    for (let i = 0; i < this.options.workers; i++) {
      const engine = this.deps.spawn();
      this.engines.push(engine);
      this.slots.push(this.slotLoop(engine).catch((error) => this.fail(error)));
    }
    this.emit();
  }

  pause(): void {
    if (this.status !== "running") return;
    this.runtimeMs += this.now() - this.runningSince;
    this.status = "paused";
    this.gate = new Promise((resolve) => (this.openGate = resolve));
    this.emit();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.runningSince = this.now();
    this.openGate?.();
    this.gate = this.openGate = null;
    this.emit();
  }

  /** Ends the session. Unfinished claims stay in IndexedDB so they can be resumed later. */
  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "idle") return;
    if (this.status === "running") this.runtimeMs += this.now() - this.runningSince;
    this.status = "stopped";
    this.openGate?.();
    this.gate = this.openGate = null;
    const unfinished = [...this.active.values()];
    for (const engine of this.engines) engine.terminate();
    for (const w of this.wake.splice(0)) w();
    await Promise.allSettled(this.slots);
    // An upload can finish while stop waits for the slots. Saving before they settle could
    // recreate a claim that upload already acknowledged and deleted.
    for (const claim of unfinished)
      if (!this.settledClaims.has(claim)) await this.deps.store.saveClaim(claim).catch(() => undefined);
    this.engines = [];
    this.slots = [];
    this.active.clear();
    this.emit();
  }

  /** Gives unfinished work back to the pool and forgets it locally. */
  async discard(): Promise<void> {
    await this.stop();
    for (const claim of await this.deps.store.listClaims(this.deps.baseUrl)) {
      await this.post(`/api/v1/jobs/${claim.job_id}/release`, {
        worker_id: claim.worker_id,
        lease_token: claim.lease_token,
      }).catch(() => undefined);
      await this.deps.store.deleteClaim(claim.job_id);
    }
    this.emit();
  }

  private fail(error: unknown): void {
    if (error instanceof Stopped || this.status === "stopped") return;
    this.message = error instanceof Error ? error.message : "unexpected error";
    this.status = "error";
    this.emit();
  }

  private async post(
    path: string,
    body: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await this.deps.fetchFn(this.deps.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    };
  }

  private async idle(ms: number): Promise<void> {
    await Promise.race([this.sleepFn(ms), new Promise<void>((resolve) => this.wake.push(resolve))]);
    if (this.status === "stopped") throw new Stopped();
  }

  private async checkGate(): Promise<void> {
    if (this.gate) await this.gate;
    if (this.status === "stopped") throw new Stopped();
  }

  private async slotLoop(engine: EngineHandle): Promise<void> {
    while (this.status !== "stopped") {
      await this.checkGate();
      const claim = this.resumeQueue.shift() ?? (await this.claimNew());
      if (!claim) {
        await this.idle(30_000);
        continue;
      }
      this.active.set(claim.job_id, claim);
      this.emit();
      try {
        await this.process(claim, engine);
      } finally {
        this.active.delete(claim.job_id);
        this.emit();
      }
    }
  }

  private async claimNew(): Promise<StoredClaim | null> {
    const reply = await this.post("/api/v1/jobs/claim", {
      worker_id: this.deps.workerId,
      problem: this.deps.problem,
      capabilities: { engine_version: ENGINE_VERSION, platform: "browser-wasm" },
    });
    if (reply.status === 429) {
      this.message = "The server asked this browser to slow down.";
      await this.idle(30_000);
      return null;
    }
    if (reply.status === 426)
      throw new Error("This server requires a newer engine. Reload the page to update.");
    if (reply.status !== 200) throw new Error(`The server could not assign work (HTTP ${reply.status}).`);
    const job = reply.json.job as {
      job_id: string;
      lease_token: string;
      lease_until: number;
      payload: Record<string, unknown>;
      checkpoint: Record<string, unknown> | null;
    } | null;
    if (!job) {
      this.message = "No work is available right now. This tab will keep checking.";
      this.emit();
      return null;
    }
    this.message = "";
    const claim: StoredClaim = {
      job_id: job.job_id,
      base_url: this.deps.baseUrl,
      worker_id: this.deps.workerId,
      lease_token: job.lease_token,
      lease_until: job.lease_until,
      payload: job.payload,
      state: job.checkpoint,
      nodes: 0,
      progress_permille: 0,
      pending_result: null,
      updated_at: this.now(),
    };
    await this.deps.store.saveClaim(claim);
    return claim;
  }

  private async process(claim: StoredClaim, engine: EngineHandle): Promise<void> {
    const started = this.now();
    let lastSave = started;
    let lastServerCheckpoint = started;
    let previousNodes = claim.nodes;
    const duty = dutyCycle(this.options.intensity);
    try {
      while (!claim.pending_result) {
        await this.checkGate();
        const t0 = this.now();
        const step = await engine.call<StepReply>("job.step", {
          def: claim.payload,
          state: claim.state,
          budget: this.budget,
        });
        const elapsed = Math.max(1, this.now() - t0);
        if (this.deps.fixedBudget === undefined)
          this.budget = Math.min(
            50_000_000,
            Math.max(10_000, Math.round(this.budget * Math.min(4, Math.max(0.25, 120 / elapsed)))),
          );
        claim.state = step.state;
        claim.progress_permille = step.progress_permille;
        this.nodesProcessed += step.nodes - previousNodes;
        previousNodes = claim.nodes = step.nodes;
        claim.updated_at = this.now();
        if (step.done && step.result) {
          claim.pending_result = { result: step.result, nodes: step.nodes, runtime_ms: this.now() - started };
          await this.deps.store.saveClaim(claim);
          break;
        }
        if (this.now() - lastSave >= (this.deps.saveIntervalMs ?? 1000)) {
          await this.deps.store.saveClaim(claim);
          lastSave = this.now();
        }
        if (this.now() - lastServerCheckpoint >= (this.deps.checkpointIntervalMs ?? 15_000)) {
          lastServerCheckpoint = this.now();
          void this.post(`/api/v1/jobs/${claim.job_id}/checkpoint`, {
            worker_id: claim.worker_id,
            lease_token: claim.lease_token,
            checkpoint: claim.state,
            nodes_processed: claim.nodes,
          }).catch(() => undefined);
        }
        this.emit();
        if (duty < 1) await this.idle((elapsed * (1 - duty)) / duty);
      }
    } catch (error) {
      if (error instanceof Stopped || this.status === "stopped") return;
      throw error;
    }
    await this.upload(claim, engine);
  }

  private async upload(claim: StoredClaim, engine: EngineHandle): Promise<void> {
    const pending = claim.pending_result!;
    const hash = await engine.call<string>("result.hash", { result: pending.result });
    for (let attempt = 0; this.status !== "stopped"; attempt++) {
      try {
        const reply = await this.post(`/api/v1/jobs/${claim.job_id}/submit`, {
          worker_id: claim.worker_id,
          lease_token: claim.lease_token,
          result: pending.result,
          result_hash: hash,
          nodes_processed: pending.nodes,
          runtime_ms: pending.runtime_ms,
          platform: "browser-wasm",
        });
        if (reply.status === 200) {
          await this.deps.store.deleteClaim(claim.job_id);
          this.settledClaims.add(claim);
          this.jobsCompleted++;
          this.runtimeMs += 0;
          this.message = `Last result: ${String(reply.json.status)}`;
          return;
        }
        if (reply.status !== 429 && reply.status >= 400 && reply.status < 500) {
          await this.deps.store.deleteClaim(claim.job_id);
          this.settledClaims.add(claim);
          this.message = `The server rejected a result (${String((reply.json.error as { code?: string } | undefined)?.code ?? reply.status)}); the job was dropped.`;
          return;
        }
      } catch {
        // network trouble: keep the finished result on disk and retry
      }
      this.message = "Waiting to upload a finished result.";
      this.emit();
      await this.idle(Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5)));
    }
  }
}
