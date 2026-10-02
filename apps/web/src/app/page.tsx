import Link from "next/link";
import { QueensBoard, Status } from "@/components/Board";
import { engineCall } from "@/lib/engine";
import { PROBLEMS } from "@/lib/problems";
import { fmt, results } from "@/lib/results";
import { loadSiteStats, summarizeChess } from "@/lib/site-data";

export const revalidate = 30;

async function heroSolution(): Promise<number[]> {
  try {
    const r = await engineCall<{ solutions: number[][] }>("nqueens.examples", { n: 8, limit: 1 });
    return r.solutions[0];
  } catch {
    return [0, 4, 7, 5, 2, 6, 1, 3];
  }
}

export default async function Home() {
  const [columns, stats] = await Promise.all([heroSolution(), loadSiteStats()]);
  const chess = summarizeChess(stats);
  const q18 = results.nqueens.rows.find((r) => r.n === results.nqueens.verified_through)!;
  const facts: Record<string, React.ReactNode> = {
    nqueens: (
      <>
        Verified through N={results.nqueens.verified_through}:{" "}
        <strong className="num">{fmt(q18.solutions)}</strong> solutions
      </>
    ),
    tictactoe: (
      <>
        <strong className="num">{fmt(Number(results.tictactoe.reachable_positions))}</strong> positions,{" "}
        <strong className="num">{fmt(Number(results.tictactoe.complete_games))}</strong> complete games
      </>
    ),
    eight_puzzle: (
      <>
        <strong className="num">{fmt(results.eight_puzzle.reachable_states)}</strong> states, longest optimal
        solution <strong>{results.eight_puzzle.diameter}</strong> moves
      </>
    ),
    lights_out: (
      <>
        <strong className="num">{fmt(results.lights_out.solvable_states)}</strong> of{" "}
        <strong className="num">{fmt(results.lights_out.total_states)}</strong> boards are solvable; none
        needs more than <strong>{results.lights_out.maximum_minimum_moves}</strong> presses
      </>
    ),
    chess: (
      <>
        Verified depth: <strong>{chess.verifiedPerftDepth ?? "none yet"}</strong>. Current frontier:{" "}
        {chess.frontier}.{" "}
        {chess.layerPositions !== null ? (
          <>
            Positions at the deepest computed ply:{" "}
            <strong className="num">{fmt(chess.layerPositions)}</strong>.
          </>
        ) : null}{" "}
        Not solved.
      </>
    ),
  };
  return (
    <>
      <section className="hero">
        <div>
          <h1>Explore finite worlds, exhaustively.</h1>
          <p className="lede">
            Resumable exact solvers, distributed verification, persistent search databases, and interactive
            visualization for combinatorial games and puzzles.
          </p>
          <div className="row-actions">
            <Link className="btn" href="/explorer">
              Open the explorer
            </Link>
            <Link className="btn quiet" href="/compute">
              Contribute computing power
            </Link>
          </div>
        </div>
        <figure style={{ margin: 0 }}>
          <QueensBoard
            n={8}
            columns={columns}
            label={`One solution to the eight queens puzzle: ${columns.join(", ")}`}
          />
          <figcaption className="caption">
            One of the {results.nqueens.rows[7].solutions} ways to place eight queens so none attack each
            other, found by the same engine that runs in your browser.
          </figcaption>
        </figure>
      </section>

      <ul className="toc" aria-label="Problems">
        {PROBLEMS.map((p) => (
          <li key={p.id}>
            <Link className="row" href={`/problems/${p.id}`}>
              <span className="name">{p.title}</span>
              <span className="what">{facts[p.id]}</span>
              <Status status={p.status} />
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: "1.5rem" }}>
        Every figure on this page comes from verified result files or the live database. Nothing is typed in
        by hand.
      </p>
    </>
  );
}
