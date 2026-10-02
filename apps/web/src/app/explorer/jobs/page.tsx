import type { Metadata } from "next";
import Link from "next/link";
import { context } from "@/lib/context";
import { isDatabaseConfigured } from "@/lib/db";
import { JOB_STATUSES, listJobs, type JobFilters } from "@/lib/jobs";

export const metadata: Metadata = { title: "Job database" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters: JobFilters = { limit: 50, offset: Math.max(0, Number(one(sp.offset)) || 0) };
  const problem = one(sp.problem);
  if (problem && /^[a-z_]{3,32}$/.test(problem)) filters.problem = problem;
  const status = one(sp.status);
  if (status && (JOB_STATUSES as readonly string[]).includes(status)) filters.status = status;
  const run = one(sp.run);
  if (run && /^[0-9a-f]{8,64}$/.test(run)) filters.runId = run;
  const depth = one(sp.depth);
  if (depth && /^\d{1,2}$/.test(depth)) filters.depth = Number(depth);
  let data: Awaited<ReturnType<typeof listJobs>> | null = null;
  if (isDatabaseConfigured()) {
    try {
      data = await listJobs((await context()).db, filters);
    } catch {
      data = null;
    }
  }
  const query = new URLSearchParams();
  if (filters.problem) query.set("problem", filters.problem);
  if (filters.status) query.set("status", filters.status);
  if (filters.runId) query.set("run", filters.runId);
  if (filters.depth !== undefined) query.set("depth", String(filters.depth));
  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href="/explorer">Explorer</Link>
      </p>
      <h1 style={{ marginTop: "0.5rem" }}>Job database</h1>
      <p className="lede">
        Each job is a deterministic work unit identified by the hash of its definition. Filters are fixed
        fields; no query language is exposed.
      </p>
      <form method="get" className="row-actions" style={{ alignItems: "end" }}>
        <div>
          <label htmlFor="f-problem">Problem</label>
          <select id="f-problem" name="problem" defaultValue={filters.problem ?? ""}>
            <option value="">All</option>
            <option value="nqueens">N-Queens</option>
            <option value="chess">Chess</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-depth">Chess depth</label>
          <input
            id="f-depth"
            name="depth"
            type="number"
            min={0}
            max={64}
            defaultValue={filters.depth ?? ""}
            style={{ width: "6rem" }}
          />
        </div>
        <button className="btn" type="submit">
          Apply filters
        </button>
        <a
          className="btn quiet"
          href={`/api/v1/explorer/jobs?${query.toString()}${query.size ? "&" : ""}download=1`}
        >
          Download JSON
        </a>
      </form>
      {data === null ? (
        <div className="notice">
          No database is connected to this deployment, so there are no jobs to show.
        </div>
      ) : data.jobs.length === 0 ? (
        <div className="notice">
          No jobs match these filters. An administrator can create a run from the command line (see the
          deployment guide).
        </div>
      ) : (
        <>
          <p className="muted">
            {data.total.toLocaleString("en-US")} jobs match. Showing {filters.offset + 1} to{" "}
            {filters.offset + data.jobs.length}.
          </p>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Problem</th>
                  <th>Status</th>
                  <th className="r">Matching results</th>
                  <th className="r">Nodes</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.job_id}>
                    <td className="mono" title={j.job_id}>
                      {j.job_id.slice(0, 12)}
                    </td>
                    <td>
                      {j.problem}
                      {j.depth !== null ? `, depth ${j.depth}` : ""}
                    </td>
                    <td>{j.status}</td>
                    <td className="r num">{j.verification_count}</td>
                    <td className="r num">{j.nodes_processed.toLocaleString("en-US")}</td>
                    <td className="mono">
                      {j.verified_result ? JSON.stringify(j.verified_result) : "not yet verified"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            {filters.offset > 0 && (
              <Link
                className="btn quiet"
                href={`/explorer/jobs?${new URLSearchParams({ ...Object.fromEntries(query), offset: String(Math.max(0, filters.offset - 50)) })}`}
              >
                Previous page
              </Link>
            )}
            {filters.offset + data.jobs.length < data.total && (
              <Link
                className="btn quiet"
                href={`/explorer/jobs?${new URLSearchParams({ ...Object.fromEntries(query), offset: String(filters.offset + 50) })}`}
              >
                Next page
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
