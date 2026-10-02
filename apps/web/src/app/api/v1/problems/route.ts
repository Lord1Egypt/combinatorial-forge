import { context } from "@/lib/context";
import { cached, route } from "@/lib/http";
import { jobStats } from "@/lib/jobs";
import { PROBLEMS } from "@/lib/problems";
import { isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  let policy: Record<string, { required_matches: number; lease_seconds: number; max_attempts: number }> = {};
  let counts: Record<string, Record<string, number>> = {};
  if (isDatabaseConfigured()) {
    const ctx = await context();
    const rows = await ctx.db.execute(
      "SELECT problem, required_matches, lease_seconds, max_attempts FROM problems",
    );
    policy = Object.fromEntries(
      rows.rows.map((r) => [
        String(r.problem),
        {
          required_matches: Number(r.required_matches),
          lease_seconds: Number(r.lease_seconds),
          max_attempts: Number(r.max_attempts),
        },
      ]),
    );
    for (const row of (await jobStats(ctx.db)).by_status) (counts[row.problem] ??= {})[row.status] = row.jobs;
  } else counts = {};
  return cached(
    {
      problems: PROBLEMS.map((p) => ({
        ...p,
        verification_policy: policy[p.id] ?? null,
        jobs: counts[p.id] ?? {},
      })),
    },
    15,
  );
});
