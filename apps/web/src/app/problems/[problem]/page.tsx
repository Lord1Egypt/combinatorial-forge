import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bars, Status } from "@/components/Board";
import { PROBLEMS, problemById } from "@/lib/problems";
import { fmt, results } from "@/lib/results";
import { loadSiteStats, summarizeChess } from "@/lib/site-data";

export const revalidate = 30;

export function generateStaticParams() {
  return PROBLEMS.map((p) => ({ problem: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ problem: string }>;
}): Promise<Metadata> {
  const p = problemById((await params).problem);
  return { title: p?.title ?? "Problem" };
}

export default async function ProblemPage({ params }: { params: Promise<{ problem: string }> }) {
  const info = problemById((await params).problem);
  if (!info) notFound();
  const stats = info.id === "chess" ? await loadSiteStats() : null;
  const chess = summarizeChess(stats);
  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href="/problems">Problems</Link>
      </p>
      <h1 style={{ marginTop: "0.5rem" }}>{info.title}</h1>
      <p style={{ marginTop: "0.75rem" }}>
        <Status status={info.status} />
      </p>
      <p className="lede">{info.summary}</p>
      <h2>Method</h2>
      <p>{info.method}</p>

      {info.id === "nqueens" && (
        <>
          <h2>Exact counts</h2>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>N</th>
                  <th className="r">Solutions</th>
                  <th className="r">Recursive</th>
                  <th className="r">Iterative</th>
                </tr>
              </thead>
              <tbody>
                {results.nqueens.rows.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td className="r num">{fmt(r.solutions)}</td>
                    <td className="r num">{r.recursive_seconds.toFixed(4)} s</td>
                    <td className="r num">{r.iterative_seconds.toFixed(4)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Both implementations agree for every N from 1 to {results.nqueens.verified_through}. Times are
            from one measured run; see Benchmarks in the documentation.
          </p>
        </>
      )}
      {info.id === "tictactoe" && (
        <dl className="kv">
          {Object.entries(results.tictactoe)
            .filter(([k]) => !["runtime_seconds", "verified"].includes(k))
            .map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k.replaceAll("_", " ")}</dt>
                <dd className="num">{typeof v === "number" ? fmt(v) : String(v)}</dd>
              </div>
            ))}
        </dl>
      )}
      {info.id === "eight_puzzle" && (
        <>
          <h2>States by distance from the goal</h2>
          <Bars
            values={results.eight_puzzle.histogram}
            label="Number of 8-puzzle states at each optimal distance from the goal"
          />
          <p>
            {fmt(results.eight_puzzle.reachable_states)} reachable states. The farthest are{" "}
            {results.eight_puzzle.diameter} moves from the goal, and every optimal path was replayed move by
            move.
          </p>
        </>
      )}
      {info.id === "lights_out" && (
        <>
          <h2>Boards by minimum presses</h2>
          <Bars
            values={results.lights_out.minimum_move_distribution}
            label="Number of solvable Lights Out boards needing each minimum number of presses"
          />
          <p>
            Of {fmt(results.lights_out.total_states)} boards, {fmt(results.lights_out.solvable_states)} are
            solvable (rank {results.lights_out.rank}, nullity {results.lights_out.nullity}).
          </p>
        </>
      )}
      {info.id === "chess" && (
        <>
          <div className="panel research">
            <strong>Chess is not solved.</strong> This module enumerates positions and move sequences by
            depth, with every number kept in one of four categories: complete results, partially explored
            results, theoretical estimates, and verified computed results.
          </div>
          <h2>What has been computed</h2>
          <dl className="kv">
            <dt>Verified move sequences</dt>
            <dd className="num">
              {chess.verifiedPerftDepth !== null
                ? `depth ${chess.verifiedPerftDepth}: ${fmt(chess.verifiedSequences ?? 0)} sequences`
                : "no run has been fully verified yet"}
            </dd>
            <dt>Distinct positions</dt>
            <dd className="num">
              {chess.layerDepth !== null
                ? `through ply ${chess.layerDepth}: ${fmt(chess.layerPositions ?? 0)} at the deepest layer`
                : "none imported yet"}
            </dd>
            <dt>Jobs</dt>
            <dd className="num">
              {chess.jobsTotal ? `${fmt(chess.jobsVerified)} of ${fmt(chess.jobsTotal)} verified` : "none"}
            </dd>
          </dl>
          <p>
            Move sequences and distinct positions are different measurements. After three plies there are
            8,902 sequences but only 5,362 distinct positions, because different move orders reach the same
            position.
          </p>
          <p>
            <Link href="/explorer/chess">Browse positions</Link> or{" "}
            <Link href="/compute">contribute computing power</Link>.
          </p>
        </>
      )}
      <p style={{ marginTop: "2rem" }}>
        <Link className="btn" href={`/explorer/${info.id}`}>
          Explore {info.title}
        </Link>
      </p>
    </>
  );
}
