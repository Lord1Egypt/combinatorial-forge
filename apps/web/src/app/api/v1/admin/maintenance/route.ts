import { requireAdmin } from "@/lib/auth";
import { context } from "@/lib/context";
import { ApiError, json, readJson, route } from "@/lib/http";
import { maintenance } from "@/lib/jobs";
import { RUN_ID, requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  requireAdmin(request);
  const body = await readJson(request, 2 * 1024);
  const ctx = await context();
  if (body.action === "expire") {
    await maintenance(ctx, true);
    return json({ ok: true });
  }
  const runId = requireString(body.run_id, "run_id", RUN_ID);
  const now = ctx.now();
  if (body.action === "reopen_failed") {
    const r = await ctx.db.execute({
      sql: "UPDATE jobs SET status = CASE WHEN verification_count > 0 THEN 'submitted' ELSE 'pending' END, attempts = 0, updated_at = ? WHERE run_id = ? AND status = 'failed'",
      args: [now, runId],
    });
    return json({ reopened: r.rowsAffected });
  }
  if (body.action === "cancel_run") {
    const r = await ctx.db.execute({
      sql: "UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE run_id = ? AND status IN ('pending', 'leased', 'running', 'submitted', 'disputed')",
      args: [now, runId],
    });
    await ctx.db.execute({ sql: "UPDATE runs SET status = 'cancelled' WHERE run_id = ?", args: [runId] });
    return json({ cancelled: r.rowsAffected });
  }
  throw new ApiError(400, "invalid_request", "action must be expire, reopen_failed or cancel_run");
});
