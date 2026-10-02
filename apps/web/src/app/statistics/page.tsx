import type { Metadata } from "next";
import { fmt, results } from "@/lib/results";
import { loadSiteStats } from "@/lib/site-data";

export const metadata: Metadata = { title: "Statistics" };
export const revalidate = 30;

export default async function Statistics() {
  const stats = await loadSiteStats();
  const env = results.environment;
  return (
    <>
      <h1>Statistics</h1>
      <p className="lede">
        Two kinds of numbers appear here: exact results from the verified result files, and live counts of
        distributed work.
      </p>

      <h2>Exact results</h2>
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Quantity</th>
              <th className="r">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>N-Queens</td>
              <td>Solutions for N={results.nqueens.verified_through}</td>
              <td className="r num">
                {fmt(results.nqueens.rows[results.nqueens.verified_through - 1].solutions)}
              </td>
            </tr>
            <tr>
              <td>Tic-Tac-Toe</td>
              <td>Reachable positions</td>
              <td className="r num">{fmt(Number(results.tictactoe.reachable_positions))}</td>
            </tr>
            <tr>
              <td>Tic-Tac-Toe</td>
              <td>Complete games</td>
              <td className="r num">{fmt(Number(results.tictactoe.complete_games))}</td>
            </tr>
            <tr>
              <td>8-Puzzle</td>
              <td>Reachable states</td>
              <td className="r num">{fmt(results.eight_puzzle.reachable_states)}</td>
            </tr>
            <tr>
              <td>8-Puzzle</td>
              <td>Diameter</td>
              <td className="r num">{results.eight_puzzle.diameter}</td>
            </tr>
            <tr>
              <td>Lights Out 5×5</td>
              <td>Solvable boards</td>
              <td className="r num">{fmt(results.lights_out.solvable_states)}</td>
            </tr>
            <tr>
              <td>Lights Out 5×5</td>
              <td>Largest minimum solution</td>
              <td className="r num">{results.lights_out.maximum_minimum_moves}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        Timings in the result files were measured on {String(env.cpu)} ({String(env.logical_cpus)} logical
        CPUs, {String(env.os)}, {String(env.compiler)}). They describe that run only.
      </p>

      <h2>Distributed computation</h2>
      {!stats ? (
        <div className="notice">
          No database is connected to this deployment, so there is no distributed work to report.
        </div>
      ) : stats.by_status.length === 0 ? (
        <div className="notice">
          No jobs exist yet. Once an administrator creates a run, progress appears here.
        </div>
      ) : (
        <>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Status</th>
                  <th className="r">Jobs</th>
                  <th className="r">Nodes processed</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_status.map((s) => (
                  <tr key={s.problem + s.status}>
                    <td>{s.problem}</td>
                    <td>{s.status}</td>
                    <td className="r num">{fmt(s.jobs)}</td>
                    <td className="r num">{fmt(s.nodes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {fmt(stats.contributing_workers)} distinct contributing workers have submitted results. Nodes are
            reported by workers and are not themselves verified.
          </p>
          <h3>Runs</h3>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Problem</th>
                  <th>Parameters</th>
                  <th className="r">Verified</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {stats.runs.map((r) => (
                  <tr key={r.run_id}>
                    <td className="mono">{r.run_id.slice(0, 10)}</td>
                    <td>{r.problem}</td>
                    <td className="mono">{JSON.stringify(r.parameters)}</td>
                    <td className="r num">
                      {fmt(r.verified_jobs)} / {fmt(r.total_jobs)}
                    </td>
                    <td className="mono">
                      {r.complete && r.aggregate
                        ? JSON.stringify(r.aggregate.solutions ?? r.aggregate.perft)
                        : "in progress"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Chess layers</h2>
      {stats && stats.chess_layers.length > 0 ? (
        <>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Ply</th>
                  <th className="r">Distinct positions</th>
                  <th className="r">Move sequences</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.chess_layers.map((l) => (
                  <tr key={l.run_id + l.ply}>
                    <td>{l.ply}</td>
                    <td className="r num">{fmt(l.unique_positions)}</td>
                    <td className="r num">
                      {l.move_sequences === null ? "not counted" : fmt(l.move_sequences)}
                    </td>
                    <td>{l.status === "complete" ? "Complete layer" : "Partial layer"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Distinct positions and move sequences are different measurements; the gap between them is the
            number of transpositions.
          </p>
        </>
      ) : (
        <div className="notice">
          No chess layers have been imported yet. Run <code>forge layers --depth 4</code> locally and import
          the result (see the chess documentation).
        </div>
      )}
    </>
  );
}
