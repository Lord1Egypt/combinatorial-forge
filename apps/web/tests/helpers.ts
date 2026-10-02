import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { engineCall } from "@/lib/engine";
import { createRun, type Ctx } from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import type { JobDefinition } from "@/lib/validate";

export interface TestEnv {
  db: Client;
  ctx: Ctx;
  clock: { now: number };
  file: string;
  cleanup: () => void;
}

export async function freshEnv(options: { distinctNetworks?: boolean } = {}): Promise<TestEnv> {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-web-test-"));
  const file = path.join(dir, "test.db");
  const db = createClient({ url: `file:${file}` });
  await db.execute("PRAGMA journal_mode=WAL");
  await migrate(db);
  const clock = { now: 1_700_000_000_000 };
  const ctx: Ctx = { db, now: () => clock.now, requireDistinctNetworks: options.distinctNetworks ?? false };
  return {
    db,
    ctx,
    clock,
    file,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Plans and inserts a real N-Queens run using the shared WebAssembly engine. */
export async function seedNQueens(ctx: Ctx, n: number, depth: number) {
  const plan = (await engineCall<{ jobs: unknown[] }>("job.plan", { problem: "nqueens", n, depth })).jobs;
  const run = await createRun(ctx, "nqueens", { n, split: depth }, plan);
  return { ...run, plan: plan as JobDefinition[] };
}

/** Honest worker: really computes the job with the shared engine. */
export async function compute(def: unknown): Promise<{ result: Record<string, number>; nodes: number }> {
  let state: unknown = null;
  for (;;) {
    const step = await engineCall<{
      done: boolean;
      state: unknown;
      nodes: number;
      result: Record<string, number>;
    }>("job.step", { def, state, budget: 100_000 });
    state = step.state;
    if (step.done) return { result: step.result, nodes: step.nodes };
  }
}

let counter = 0;
export const worker = (name: string) => `w-${name}-${String(++counter).padStart(6, "0")}`;
