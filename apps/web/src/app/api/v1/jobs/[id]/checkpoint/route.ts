import { ApiError, clientAddress, json, readJson, route } from "@/lib/http";
import { context } from "@/lib/context";
import { checkpointJob } from "@/lib/jobs";
import { contributionLimiter } from "@/lib/ratelimit";
import { HEX64, TOKEN, WORKER_ID, isObject, needInt, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const jobId = requireString(id, "job id", HEX64);
  const body = await readJson(request, 96 * 1024);
  const workerId = requireString(body.worker_id, "worker_id", WORKER_ID);
  const token = requireString(body.lease_token, "lease_token", TOKEN);
  if (!isObject(body.checkpoint)) throw new ApiError(400, "invalid_request", "checkpoint must be an object");
  if (!contributionLimiter.allow(`cp:${clientAddress(request)}`))
    throw new ApiError(429, "rate_limited", "slow down");
  const nodes = needInt(body.nodes_processed ?? 0, "nodes_processed", 0, Number.MAX_SAFE_INTEGER);
  return json(
    await checkpointJob(await context(), { jobId, workerId, token, checkpoint: body.checkpoint, nodes }),
  );
});
