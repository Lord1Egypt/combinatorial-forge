import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { canonicalJson, sha256Hex } from "./canonical";
import { ENGINE_VERSION } from "./jobs";

export interface SnapshotFile {
  name: string;
  content: string;
}

export interface BuiltSnapshot {
  snapshotId: string;
  manifest: Record<string, unknown>;
  files: SnapshotFile[];
}

const str = (v: unknown) => String(v);
const num = (v: unknown) => Number(v);

/**
 * Builds an immutable snapshot: verified results only (submitted/disputed work is never published).
 * The manifest records hashes of every other file; SHA256SUMS covers all of them.
 */
export async function buildSnapshot(
  db: Client,
  opts: { projectCommit: string; siteUrl: string; now: number; schemaVersion: number },
): Promise<BuiltSnapshot> {
  const verified = await db.execute(
    "SELECT job_id, run_id, problem, solver_version, payload, verified_result_hash, verified_result, nodes_processed, verification_count FROM jobs WHERE status = 'verified' ORDER BY job_id",
  );
  const counts = await db.execute(
    "SELECT problem, status, COUNT(*) AS n, COALESCE(SUM(nodes_processed), 0) AS nodes FROM jobs GROUP BY problem, status ORDER BY problem, status",
  );
  const aggregates = await db.execute(
    "SELECT run_id, result, result_hash, verified_jobs, total_jobs, complete FROM aggregate_results ORDER BY run_id",
  );
  const solvers = await db.execute(
    "SELECT problem, solver_version, engine_version, source_commit, compiler, build_config, platform FROM solver_versions ORDER BY problem, solver_version",
  );
  const layers = await db.execute(
    "SELECT run_id, ply, unique_positions, move_sequences, status FROM chess_layers ORDER BY run_id, ply",
  );

  const data = {
    format: "forge-verified-results/1",
    jobs: verified.rows.map((r) => ({
      job_id: str(r.job_id),
      run_id: str(r.run_id),
      problem: str(r.problem),
      solver_version: str(r.solver_version),
      definition: JSON.parse(str(r.payload)),
      result_hash: str(r.verified_result_hash),
      result: JSON.parse(str(r.verified_result)),
      nodes_processed: num(r.nodes_processed),
      matching_submissions: num(r.verification_count),
    })),
  };
  const verifiedByProblem: Record<string, number> = {};
  const nodesVerified: Record<string, number> = {};
  const statusCounts: Record<string, Record<string, number>> = {};
  for (const r of counts.rows) {
    const p = str(r.problem);
    (statusCounts[p] ??= {})[str(r.status)] = num(r.n);
    if (str(r.status) === "verified") {
      verifiedByProblem[p] = num(r.n);
      nodesVerified[p] = num(r.nodes);
    }
  }
  const statistics = {
    format: "forge-statistics/1",
    generated_at: opts.now,
    jobs_by_problem_and_status: statusCounts,
    verified_nodes_processed: nodesVerified,
    aggregate_results: aggregates.rows.map((r) => ({
      run_id: str(r.run_id),
      result: JSON.parse(str(r.result)),
      result_hash: str(r.result_hash),
      verified_jobs: num(r.verified_jobs),
      total_jobs: num(r.total_jobs),
      complete: num(r.complete) === 1,
    })),
    chess_layers: layers.rows.map((r) => ({
      run_id: str(r.run_id),
      ply: num(r.ply),
      unique_positions: num(r.unique_positions),
      move_sequences: r.move_sequences === null ? null : num(r.move_sequences),
      status: str(r.status),
    })),
  };
  const dataText = canonicalJson(data) + "\n";
  const statisticsText = canonicalJson(statistics) + "\n";
  const snapshotId =
    new Date(opts.now).toISOString().slice(0, 10).replaceAll("-", "") +
    "-" +
    sha256Hex(dataText + statisticsText).slice(0, 10);
  const dataFile = { name: "verified-results.json", content: dataText };
  const statsFile = { name: "statistics.json", content: statisticsText };
  const manifest = {
    format: "forge-snapshot-manifest/1",
    snapshot_id: snapshotId,
    created_at: opts.now,
    schema_version: opts.schemaVersion,
    project_commit: opts.projectCommit,
    engine_version: ENGINE_VERSION,
    site_url: opts.siteUrl,
    solver_versions: solvers.rows.map((r) => ({
      problem: str(r.problem),
      solver_version: str(r.solver_version),
      engine_version: str(r.engine_version),
      source_commit: r.source_commit === null ? null : str(r.source_commit),
      compiler: r.compiler === null ? null : str(r.compiler),
      build_config: r.build_config === null ? null : str(r.build_config),
    })),
    problem_versions: { nqueens: "1", chess: "1" },
    verified_job_counts: verifiedByProblem,
    aggregate_results: statistics.aggregate_results,
    files: [dataFile, statsFile].map((f) => ({
      name: f.name,
      sha256: sha256Hex(f.content),
      bytes: Buffer.byteLength(f.content),
    })),
  };
  const manifestFile = { name: "manifest.json", content: canonicalJson(manifest) + "\n" };
  const sums = [dataFile, statsFile, manifestFile]
    .map((f) => `${sha256Hex(f.content)}  ${f.name}\n`)
    .join("");
  return {
    snapshotId,
    manifest,
    files: [manifestFile, { name: "SHA256SUMS", content: sums }, statsFile, dataFile],
  };
}

export async function storeSnapshot(
  db: Client,
  built: BuiltSnapshot,
  opts: { projectCommit: string; schemaVersion: number; now: number },
): Promise<void> {
  const manifestText = built.files.find((f) => f.name === "manifest.json")!.content;
  await db.batch(
    [
      {
        sql: "INSERT OR IGNORE INTO snapshots (snapshot_id, created_at, schema_version, project_commit, manifest, manifest_sha256) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          built.snapshotId,
          opts.now,
          opts.schemaVersion,
          opts.projectCommit,
          manifestText,
          sha256Hex(manifestText),
        ],
      },
      ...built.files.map((f) => ({
        sql: "INSERT OR IGNORE INTO snapshot_files (snapshot_id, name, sha256, bytes, content) VALUES (?, ?, ?, ?, ?)",
        args: [built.snapshotId, f.name, sha256Hex(f.content), Buffer.byteLength(f.content), f.content],
      })),
    ],
    "write",
  );
}

export async function listSnapshots(db: Client) {
  const r = await db.execute(
    "SELECT snapshot_id, created_at, schema_version, project_commit, manifest_sha256 FROM snapshots ORDER BY created_at DESC LIMIT 100",
  );
  return r.rows.map((row) => ({
    snapshot_id: str(row.snapshot_id),
    created_at: num(row.created_at),
    schema_version: num(row.schema_version),
    project_commit: row.project_commit === null ? null : str(row.project_commit),
    manifest_sha256: str(row.manifest_sha256),
  }));
}

export const newId = () => randomUUID();
