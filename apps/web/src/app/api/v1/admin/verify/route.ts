import { requireAdmin } from "@/lib/auth";
import { context } from "@/lib/context";
import { engineCall } from "@/lib/engine";
import { ApiError, json, readJson, route } from "@/lib/http";
import { submitResult } from "@/lib/jobs";
import { HEX64, isObject, needInt, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const RECOMPUTE_BUDGET_MS = 20_000;

interface Step {
  done: boolean;
  state: unknown;
  nodes: number;
  result: unknown;
}

/**
 * Trusted verification. `mode: "recompute"` runs the job on the server with the shared WebAssembly engine
 * (small jobs only); `mode: "submit"` records a result produced by a trusted native verifier (`forge audit`).
 * A trusted result decides the job; a disagreement with an already verified result reopens it.
 */
export const POST = route(async (request: Request) => {
  requireAdmin(request);
  const body = await readJson(request, 16 * 1024);
  const jobId = requireString(body.job_id, "job_id", HEX64);
  const ctx = await context();
  const found = await ctx.db.execute({ sql: "SELECT payload FROM jobs WHERE job_id = ?", args: [jobId] });
  if (found.rows.length === 0) throw new ApiError(404, "unknown_job", "unknown job");
  if (body.mode === "recompute") {
    const def = JSON.parse(String(found.rows[0].payload));
    const started = Date.now();
    let state: unknown = null;
    for (;;) {
      const step = await engineCall<Step>("job.step", { def, state, budget: 2_000_000 });
      state = step.state;
      if (step.done) {
        const outcome = await submitResult(ctx, {
          jobId,
          workerId: "trusted:server-wasm",
          token: null,
          trusted: true,
          method: "trusted-recompute",
          result: step.result,
          nodes: step.nodes,
          runtimeMs: Date.now() - started,
          platform: "wasm-server",
          networkHash: null,
        });
        return json(outcome);
      }
      if (Date.now() - started > RECOMPUTE_BUDGET_MS)
        throw new ApiError(
          422,
          "too_large",
          "job is too large to recompute on the server; verify it with a native worker",
        );
    }
  }
  if (body.mode === "submit") {
    if (!isObject(body.result)) throw new ApiError(400, "invalid_request", "result must be an object");
    const verifier = requireString(body.verifier ?? "native", "verifier", /^[a-z0-9_-]{1,24}$/);
    const outcome = await submitResult(ctx, {
      jobId,
      workerId: `trusted:${verifier}`,
      token: null,
      trusted: true,
      method: "trusted-native",
      result: body.result,
      nodes: needInt(body.nodes_processed ?? 0, "nodes_processed", 0, Number.MAX_SAFE_INTEGER),
      runtimeMs: needInt(body.runtime_ms ?? 0, "runtime_ms", 0, 7 * 24 * 3600 * 1000),
      platform: typeof body.platform === "string" ? body.platform : null,
      networkHash: null,
    });
    return json(outcome);
  }
  throw new ApiError(400, "invalid_request", 'mode must be "recompute" or "submit"');
});
