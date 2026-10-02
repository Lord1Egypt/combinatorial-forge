"use client";

import { useCallback, useEffect, useState } from "react";
import { Bars } from "@/components/Board";
import { useEngine } from "./useEngine";

interface Solution {
  solvable: boolean;
  distance?: number;
  moves?: string;
  path?: string[];
}

const GOAL = "123456780";
const DIRECTION: Record<string, string> = { U: "up", D: "down", L: "left", R: "right" };

function slide(board: string, index: number): string | null {
  const blank = board.indexOf("0");
  const dr = Math.abs(Math.floor(index / 3) - Math.floor(blank / 3));
  const dc = Math.abs((index % 3) - (blank % 3));
  if (dr + dc !== 1) return null;
  const cells = [...board];
  [cells[blank], cells[index]] = [cells[index], cells[blank]];
  return cells.join("");
}

export function EightPuzzleExplorer({ histogram, diameter }: { histogram: number[]; diameter: number }) {
  const [board, setBoard] = useState("123456708");
  const [solution, setSolution] = useState<Solution | null>(null);
  const [step, setStep] = useState(0);
  const { call, error } = useEngine();
  const solve = useCallback(
    async (b: string) => {
      const s = await call<Solution>("puzzle8.solve", { board: b });
      setSolution(s);
      setStep(0);
    },
    [call],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only initialisation after hydration
    void solve(board);
    // solve only when the board is changed by the person, not when stepping along a path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = solution?.path && step > 0 ? solution.path[step] : board;
  const hint =
    solution?.solvable && solution.moves && step < (solution.moves.length ?? 0) ? solution.moves[step] : null;
  const blank = shown.indexOf("0");
  const hintIndex = hint ? blank + (hint === "U" ? -3 : hint === "D" ? 3 : hint === "L" ? -1 : 1) : -1;
  const change = (b: string) => {
    setBoard(b);
    void solve(b);
  };
  function shuffle() {
    let b = GOAL;
    let last = -1;
    for (let i = 0; i < 60; i++) {
      const blankAt = b.indexOf("0");
      const options = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((j) => j !== last && slide(b, j) !== null);
      const pick = options[Math.floor(Math.random() * options.length)];
      last = blankAt;
      b = slide(b, pick)!;
    }
    change(b);
  }
  return (
    <div className="cols">
      <div>
        <div
          className="grid-cells"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          role="group"
          aria-label="8-puzzle board"
        >
          {[...shown].map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cell ${c === "0" ? "blank" : ""} ${i === hintIndex ? "hint" : ""}`}
              disabled={c === "0"}
              onClick={() => {
                const next = slide(shown, i);
                if (next) change(next);
              }}
              aria-label={c === "0" ? "Blank" : `Tile ${c}`}
            >
              {c === "0" ? "" : c}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <button className="btn quiet" type="button" onClick={shuffle}>
            Shuffle
          </button>
          <button className="btn quiet" type="button" onClick={() => change(GOAL)}>
            Goal
          </button>
        </div>
      </div>
      <div>
        {solution?.solvable ? (
          <>
            <p style={{ marginTop: 0 }}>
              <strong className="num">{(solution.distance ?? 0) - step}</strong> moves from the goal
              {step > 0 ? ` (started at ${solution.distance})` : ""}. The highlighted tile is the next move of
              an optimal solution.
            </p>
            <div className="row-actions" style={{ marginTop: "0.75rem" }}>
              <button
                className="btn quiet"
                type="button"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                Previous move
              </button>
              <button
                className="btn quiet"
                type="button"
                disabled={step >= (solution.distance ?? 0)}
                onClick={() => setStep(step + 1)}
              >
                Next move
              </button>
            </div>
            {solution.moves ? (
              <p className="muted">
                Optimal solution (blank moves):{" "}
                {[...solution.moves].map((m) => DIRECTION[m]).join(", ") || "already solved"}.
              </p>
            ) : null}
          </>
        ) : solution ? (
          <p style={{ marginTop: 0 }}>
            This arrangement cannot be solved: half of all permutations are unreachable.
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        <h3>Distance histogram</h3>
        <Bars values={histogram} label="Number of states at each optimal distance from the goal" />
        <p className="muted">Longest optimal solution: {diameter} moves.</p>
      </div>
    </div>
  );
}
