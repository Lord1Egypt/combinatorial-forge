import { requireAdmin } from "@/lib/auth";
import { context } from "@/lib/context";
import { engineCall } from "@/lib/engine";
import { ApiError, json, readJson, route } from "@/lib/http";
import { createRun } from "@/lib/jobs";
import { MAX_NQUEENS_N, needInt, type Obj } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_JOBS = 20_000;

export const POST = route(async (request: Request) => {
  requireAdmin(request);
  const body = await readJson(request, 4 * 1024);
  let plan: unknown[];
  let parameters: Obj;
  if (body.problem === "nqueens") {
    const n = needInt(body.n, "n", 4, MAX_NQUEENS_N);
    const depth = needInt(body.depth ?? Math.min(3, n), "depth", 1, Math.min(6, n));
    plan = (await engineCall<{ jobs: unknown[] }>("job.plan", { problem: "nqueens", n, depth })).jobs;
    parameters = { n, split: depth };
  } else if (body.problem === "chess") {
    const depth = needInt(body.depth, "depth", 1, 8);
    const split = needInt(body.split ?? Math.min(2, depth), "split", 0, Math.min(3, depth));
    plan = (await engineCall<{ jobs: unknown[] }>("job.plan", { problem: "chess", path_depth: split, depth }))
      .jobs;
    parameters = { depth, split };
  } else throw new ApiError(400, "unsupported_problem", "runs can be created for nqueens or chess");
  if (plan.length > MAX_JOBS)
    throw new ApiError(400, "run_too_large", `a run may have at most ${MAX_JOBS} jobs; use a smaller split`);
  const priority = needInt(body.priority ?? 0, "priority", 0, 100);
  const run = await createRun(await context(), String(body.problem), parameters, plan, priority);
  return json({ run_id: run.runId, total_jobs: run.totalJobs, newly_inserted: run.inserted }, 201);
});
