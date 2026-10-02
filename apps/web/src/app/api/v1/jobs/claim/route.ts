import { clientAddress, ApiError, json, readJson, route } from "@/lib/http";
import { context } from "@/lib/context";
import { claimJob, ENGINE_VERSION } from "@/lib/jobs";
import { contributionLimiter } from "@/lib/ratelimit";
import { PROBLEM, RUN_ID, WORKER_ID, isObject, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const body = await readJson(request, 8 * 1024);
  const workerId = requireString(body.worker_id, "worker_id", WORKER_ID);
  const problem = requireString(body.problem, "problem", PROBLEM);
  const runId =
    body.run_id === undefined || body.run_id === null ? null : requireString(body.run_id, "run_id", RUN_ID);
  const capabilities = isObject(body.capabilities) ? body.capabilities : {};
  if (capabilities.engine_version !== ENGINE_VERSION)
    throw new ApiError(
      426,
      "engine_mismatch",
      `this server requires engine ${ENGINE_VERSION}; update your worker`,
      { required_engine: ENGINE_VERSION },
    );
  const address = clientAddress(request);
  if (
    !contributionLimiter.allow(`claim:${address}`) ||
    !contributionLimiter.allow(`claim-worker:${workerId}`)
  )
    throw new ApiError(429, "rate_limited", "slow down");
  const platform = typeof capabilities.platform === "string" ? capabilities.platform : null;
  const job = await claimJob(await context(), { workerId, problem, runId, platform });
  return json(job ? { job } : { job: null, retry_after_seconds: 30 });
});
