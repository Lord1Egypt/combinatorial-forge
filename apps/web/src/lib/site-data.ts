import { chessLayers } from "./explorer";
import { context } from "./context";
import { isDatabaseConfigured } from "./db";
import { jobStats } from "./jobs";

export type SiteStats = Awaited<ReturnType<typeof jobStats>> & {
  chess_layers: Awaited<ReturnType<typeof chessLayers>>;
};

/** Live database figures for server-rendered pages; null when no database is reachable. */
export async function loadSiteStats(): Promise<SiteStats | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const ctx = await context();
    return { ...(await jobStats(ctx.db)), chess_layers: await chessLayers(ctx.db) };
  } catch {
    return null;
  }
}

export interface ChessSummary {
  verifiedPerftDepth: number | null;
  verifiedSequences: number | null;
  layerDepth: number | null;
  layerPositions: number | null;
  frontier: string;
  jobsVerified: number;
  jobsTotal: number;
}

/** Derives the chess headline strictly from stored data; nothing here is hand-entered. */
export function summarizeChess(stats: SiteStats | null): ChessSummary {
  const summary: ChessSummary = {
    verifiedPerftDepth: null,
    verifiedSequences: null,
    layerDepth: null,
    layerPositions: null,
    frontier: "nothing computed yet",
    jobsVerified: 0,
    jobsTotal: 0,
  };
  if (!stats) return summary;
  for (const run of stats.runs) {
    if (run.problem !== "chess" || !run.aggregate) continue;
    summary.jobsVerified += run.verified_jobs;
    summary.jobsTotal += run.total_jobs;
    const depth = Number((run.parameters as { depth?: number }).depth);
    const perft = (run.aggregate as { perft?: { nodes?: number } }).perft;
    if (
      run.complete &&
      Number.isFinite(depth) &&
      perft?.nodes &&
      (summary.verifiedPerftDepth === null || depth > summary.verifiedPerftDepth)
    ) {
      summary.verifiedPerftDepth = depth;
      summary.verifiedSequences = perft.nodes;
    }
  }
  const complete = stats.chess_layers.filter((l) => l.status === "complete");
  if (complete.length > 0) {
    const top = complete.reduce((a, b) => (b.ply > a.ply ? b : a));
    summary.layerDepth = top.ply;
    summary.layerPositions = top.unique_positions;
  }
  const parts: string[] = [];
  if (summary.verifiedPerftDepth !== null)
    parts.push(`move sequences verified to depth ${summary.verifiedPerftDepth}`);
  if (summary.layerDepth !== null) parts.push(`distinct positions computed to ply ${summary.layerDepth}`);
  if (parts.length) summary.frontier = parts.join("; ");
  return summary;
}
