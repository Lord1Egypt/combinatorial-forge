import { ApiError, clientAddress, json, readJson, route } from "@/lib/http";
import { networkHash } from "@/lib/auth";
import { context } from "@/lib/context";
import { submitResult } from "@/lib/jobs";
import { contributionLimiter } from "@/lib/ratelimit";
import { HEX64, TOKEN, WORKER_ID, needInt, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const jobId = requireString(id, "job id", HEX64);
  const body = await readJson(request, 16 * 1024);
  const workerId = requireString(body.worker_id, "worker_id", WORKER_ID);
  const token = requireString(body.lease_token, "lease_token", TOKEN);
  if (!contributionLimiter.allow(`submit:${clientAddress(request)}`))
    throw new ApiError(429, "rate_limited", "slow down");
  const clientHash =
    body.result_hash === undefined ? null : requireString(body.result_hash, "result_hash", HEX64);
  const outcome = await submitResult(await context(), {
    jobId,
    workerId,
    token,
    result: body.result,
    clientHash,
    nodes: needInt(body.nodes_processed ?? 0, "nodes_processed", 0, Number.MAX_SAFE_INTEGER),
    runtimeMs: needInt(body.runtime_ms ?? 0, "runtime_ms", 0, 7 * 24 * 3600 * 1000),
    platform: typeof body.platform === "string" ? body.platform : null,
    networkHash: networkHash(request),
  });
  return json(outcome);
});
