import { context } from "@/lib/context";
import { ApiError, cached, route } from "@/lib/http";
import { JOB_STATUSES, listJobs, type JobFilters } from "@/lib/jobs";
import { HEX64, PROBLEM, RUN_ID, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

function intParam(search: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = search.get(key);
  if (raw === null) return fallback;
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new ApiError(400, "invalid_parameter", `${key} must be an integer between ${min} and ${max}`);
  return Number(raw);
}

/** Filtered job browser. `?download=1` returns the page as a JSON file. */
export const GET = route(async (request: Request) => {
  const search = new URL(request.url).searchParams;
  const filters: JobFilters = {
    limit: intParam(search, "limit", 50, 1, 200),
    offset: intParam(search, "offset", 0, 0, 1_000_000_000),
  };
  const problem = search.get("problem");
  if (problem) filters.problem = requireString(problem, "problem", PROBLEM);
  const run = search.get("run");
  if (run) filters.runId = requireString(run, "run", RUN_ID);
  const solver = search.get("solver_version");
  if (solver) filters.solverVersion = requireString(solver, "solver_version", /^[a-z0-9_.\/-]{3,64}$/);
  const status = search.get("status");
  if (status) {
    if (!(JOB_STATUSES as readonly string[]).includes(status))
      throw new ApiError(400, "invalid_parameter", "unknown status");
    filters.status = status;
  }
  if (search.get("depth") !== null) filters.depth = intParam(search, "depth", 0, 0, 64);
  const result = search.get("result");
  if (result) filters.resultHash = requireString(result, "result", HEX64);
  const job = search.get("job");
  if (job) filters.jobId = requireString(job, "job", HEX64);
  const ctx = await context();
  const body = { filters, ...(await listJobs(ctx.db, filters)) };
  const response = cached(body, 10);
  if (search.get("download") === "1")
    response.headers.set("Content-Disposition", 'attachment; filename="forge-jobs.json"');
  return response;
});
