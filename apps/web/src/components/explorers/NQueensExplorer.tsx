"use client";

import { useEffect, useState } from "react";
import { QueensBoard } from "@/components/Board";
import { useEngine } from "./useEngine";

interface Row {
  n: number;
  solutions: number;
  recursive_seconds: number;
  iterative_seconds: number;
}

export function NQueensExplorer({ rows, verifiedThrough }: { rows: Row[]; verifiedThrough: number }) {
  const [n, setN] = useState(8);
  const [index, setIndex] = useState(0);
  const [examples, setExamples] = useState<number[][]>([]);
  const { call, error } = useEngine();
  const row = rows.find((r) => r.n === n)!;
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only initialisation after hydration
    setIndex(0);
    if (row.solutions === 0 || n > 16) {
      setExamples([]);
      return;
    }
    call<{ solutions: number[][] }>("nqueens.examples", { n, limit: 6 }).then(
      (r) => live && setExamples(r?.solutions ?? []),
    );
    return () => {
      live = false;
    };
  }, [n, row.solutions, call]);
  return (
    <div className="cols">
      <div>
        <label htmlFor="nq-n">Board size N</label>
        <select id="nq-n" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {rows.map((r) => (
            <option key={r.n} value={r.n}>
              {r.n}
            </option>
          ))}
        </select>
        <dl className="kv">
          <dt>Exact solutions</dt>
          <dd className="num big">{row.solutions.toLocaleString("en-US")}</dd>
          <dt>Recursive solver</dt>
          <dd className="num">{row.recursive_seconds.toFixed(4)} s</dd>
          <dt>Iterative solver</dt>
          <dd className="num">{row.iterative_seconds.toFixed(4)} s</dd>
          <dt>Verification</dt>
          <dd>Two independent implementations agree (verified through N={verifiedThrough}).</dd>
        </dl>
      </div>
      <div>
        {examples.length > 0 ? (
          <>
            <QueensBoard n={n} columns={examples[index]} />
            <div className="row-actions">
              <button
                className="btn quiet"
                type="button"
                onClick={() => setIndex((index + examples.length - 1) % examples.length)}
              >
                Previous
              </button>
              <button
                className="btn quiet"
                type="button"
                onClick={() => setIndex((index + 1) % examples.length)}
              >
                Next
              </button>
            </div>
            <p className="caption">
              Solution {index + 1} of the first {examples.length} in lexicographic order.
            </p>
          </>
        ) : (
          <p className="muted">
            {row.solutions === 0 ? `There is no placement for N=${n}.` : "Boards are shown up to N=16."}
          </p>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
