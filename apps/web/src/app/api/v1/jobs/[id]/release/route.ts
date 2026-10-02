import { json, readJson, route } from "@/lib/http";
import { context } from "@/lib/context";
import { releaseJob } from "@/lib/jobs";
import { HEX64, TOKEN, WORKER_ID, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await readJson(request, 4 * 1024);
  await releaseJob(await context(), {
    jobId: requireString(id, "job id", HEX64),
    workerId: requireString(body.worker_id, "worker_id", WORKER_ID),
    token: requireString(body.lease_token, "lease_token", TOKEN),
  });
  return json({ released: true });
});
