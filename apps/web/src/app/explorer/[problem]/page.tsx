import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChessExplorer } from "@/components/explorers/ChessExplorer";
import { EightPuzzleExplorer } from "@/components/explorers/EightPuzzleExplorer";
import { LightsOutExplorer } from "@/components/explorers/LightsOutExplorer";
import { NQueensExplorer } from "@/components/explorers/NQueensExplorer";
import { TicTacToeExplorer } from "@/components/explorers/TicTacToeExplorer";
import { PROBLEMS, problemById } from "@/lib/problems";
import { results } from "@/lib/results";

export function generateStaticParams() {
  return PROBLEMS.map((p) => ({ problem: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ problem: string }>;
}): Promise<Metadata> {
  return { title: `Explore ${problemById((await params).problem)?.title ?? ""}` };
}

export default async function ExplorerPage({ params }: { params: Promise<{ problem: string }> }) {
  const info = problemById((await params).problem);
  if (!info) notFound();
  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href="/explorer">Explorer</Link>
      </p>
      <h1 style={{ marginTop: "0.5rem" }}>{info.title}</h1>
      {info.id === "chess" ? (
        <div className="panel research">
          Research computation. These positions come from legal move generation, not from a solution of chess,
          which does not exist.
        </div>
      ) : null}
      <div style={{ marginTop: "1.5rem" }}>
        {info.id === "nqueens" && (
          <NQueensExplorer rows={results.nqueens.rows} verifiedThrough={results.nqueens.verified_through} />
        )}
        {info.id === "tictactoe" && <TicTacToeExplorer stats={results.tictactoe} />}
        {info.id === "eight_puzzle" && (
          <EightPuzzleExplorer
            histogram={results.eight_puzzle.histogram}
            diameter={results.eight_puzzle.diameter}
          />
        )}
        {info.id === "lights_out" && (
          <LightsOutExplorer
            distribution={results.lights_out.minimum_move_distribution}
            solvable={results.lights_out.solvable_states}
            total={results.lights_out.total_states}
          />
        )}
        {info.id === "chess" && <ChessExplorer />}
      </div>
    </>
  );
}
