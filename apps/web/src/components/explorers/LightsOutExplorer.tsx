"use client";

import { useState } from "react";
import { Bars } from "@/components/Board";
import { useEngine } from "./useEngine";

interface Solution {
  solvable: boolean;
  minimum_moves?: number;
  presses?: string;
  replay?: string[];
}

function press(board: string, index: number): string {
  const cells = [...board];
  const r = Math.floor(index / 5);
  const c = index % 5;
  for (const [dr, dc] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < 5 && cc >= 0 && cc < 5) cells[rr * 5 + cc] = cells[rr * 5 + cc] === "1" ? "0" : "1";
  }
  return cells.join("");
}

export function LightsOutExplorer({
  distribution,
  solvable,
  total,
}: {
  distribution: number[];
  solvable: number;
  total: number;
}) {
  const [board, setBoard] = useState("0".repeat(12) + "1" + "0".repeat(12));
  const [solution, setSolution] = useState<Solution | null>(null);
  const [step, setStep] = useState(0);
  const { call, error } = useEngine();
  const pressIndexes = solution?.presses
    ? [...solution.presses].flatMap((c, i) => (c === "1" ? [i] : []))
    : [];
  const shown = solution?.replay && step > 0 ? solution.replay[step] : board;
  async function solve(b: string) {
    setStep(0);
    setSolution(await call<Solution>("lights.solve", { board: b }));
  }
  function randomBoard() {
    let b = "0".repeat(25);
    for (let i = 0; i < 25; i++) if (Math.random() < 0.5) b = press(b, i);
    setBoard(b);
    setSolution(null);
  }
  const nextPress = solution?.solvable && step < pressIndexes.length ? pressIndexes[step] : -1;
  return (
    <div className="cols">
      <div>
        <div
          className="grid-cells"
          style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
          role="group"
          aria-label="Lights Out board"
        >
          {[...shown].map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cell ${c === "1" ? "on" : ""} ${i === nextPress ? "hint" : ""}`}
              onClick={() => {
                setBoard(press(shown, i));
                setSolution(null);
                setStep(0);
              }}
              aria-label={`Light ${i + 1}, ${c === "1" ? "on" : "off"}`}
            />
          ))}
        </div>
        <div className="row-actions">
          <button className="btn" type="button" onClick={() => solve(shown)}>
            Solve optimally
          </button>
          <button className="btn quiet" type="button" onClick={randomBoard}>
            Random board
          </button>
          <button
            className="btn quiet"
            type="button"
            onClick={() => {
              setBoard("0".repeat(25));
              setSolution(null);
              setStep(0);
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <div>
        {solution?.solvable ? (
          <>
            <p style={{ marginTop: 0 }}>
              Solvable in at least <strong className="num">{solution.minimum_moves}</strong> presses. The
              highlighted light is the next press.
            </p>
            <div className="row-actions" style={{ marginTop: "0.75rem" }}>
              <button
                className="btn quiet"
                type="button"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                Previous press
              </button>
              <button
                className="btn quiet"
                type="button"
                disabled={step >= pressIndexes.length}
                onClick={() => setStep(step + 1)}
              >
                Next press
              </button>
            </div>
            <p className="muted">
              Press {step} of {pressIndexes.length}. Press order does not matter.
            </p>
          </>
        ) : solution ? (
          <p style={{ marginTop: 0 }}>This board has no solution. Only one board in four can be cleared.</p>
        ) : (
          <p style={{ marginTop: 0 }}>
            Click lights to toggle a cross, or pick a random board and ask for the shortest solution.
          </p>
        )}
        {error ? <p className="error">{error}</p> : null}
        <h3>Minimum presses across all boards</h3>
        <Bars values={distribution} label="Number of solvable boards by minimum number of presses" />
        <p className="muted">
          {solvable.toLocaleString("en-US")} of {total.toLocaleString("en-US")} boards are solvable.
        </p>
      </div>
    </div>
  );
}
