"use client";

import { useCallback, useEffect, useState } from "react";
import { useEngine } from "./useEngine";

interface Position {
  board: string;
  reachable: boolean;
  ply?: number;
  turn?: "x" | "o" | null;
  winner?: "x" | "o" | null;
  terminal?: boolean;
  minimax?: "x_win" | "o_win" | "draw";
  children?: { move: number; board: string; minimax: string }[];
  parents?: { move: number; board: string; player: string }[];
}

const VERDICT: Record<string, string> = { x_win: "X wins", o_win: "O wins", draw: "a draw" };

export function TicTacToeExplorer({ stats }: { stats: Record<string, number | string | boolean> }) {
  const [board, setBoard] = useState("---------");
  const [position, setPosition] = useState<Position | null>(null);
  const { call, error } = useEngine();
  const load = useCallback(
    (b: string) => call<Position>("ttt.position", { board: b }).then(setPosition),
    [call],
  );
  useEffect(() => {
    void load(board);
  }, [board, load]);
  const play = (i: number) => {
    const child = position?.children?.find((c) => c.move === i);
    if (child) setBoard(child.board);
  };
  return (
    <div className="cols">
      <div>
        <div
          className="grid-cells"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
          role="group"
          aria-label="Tic-Tac-Toe board"
        >
          {[...board].map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cell ${c === "-" ? "" : "on"}`}
              onClick={() => play(i)}
              aria-label={`Square ${i + 1}: ${c === "-" ? "empty" : c.toUpperCase()}`}
            >
              {c === "-" ? "" : c.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <button className="btn quiet" type="button" onClick={() => setBoard("---------")}>
            New game
          </button>
          <button
            className="btn quiet"
            type="button"
            disabled={!position?.parents?.length}
            onClick={() => position?.parents?.[0] && setBoard(position.parents[0].board)}
          >
            Undo
          </button>
        </div>
      </div>
      <div>
        {position?.reachable ? (
          <>
            <p style={{ marginTop: 0 }}>
              {position.terminal
                ? position.winner
                  ? `${position.winner.toUpperCase()} has won.`
                  : "The game is a draw."
                : `${position.turn?.toUpperCase()} to move.`}{" "}
              With perfect play from here the result is <strong>{VERDICT[position.minimax ?? "draw"]}</strong>
              .
            </p>
            {position.children?.length ? (
              <>
                <h3 style={{ marginTop: "1.25rem" }}>Moves from here</h3>
                <table className="data">
                  <tbody>
                    {position.children.map((c) => (
                      <tr key={c.move}>
                        <td>
                          <button className="chip" type="button" onClick={() => setBoard(c.board)}>
                            Square {c.move + 1}
                          </button>
                        </td>
                        <td>leads to {VERDICT[c.minimax]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
            <p className="muted">
              Reached from {position.parents?.length ?? 0} earlier position
              {position.parents?.length === 1 ? "" : "s"}. Position {position.ply} plies deep.
            </p>
          </>
        ) : (
          <p>That arrangement cannot occur in a real game.</p>
        )}
        {error ? <p className="error">{error}</p> : null}
        <h3>Whole game tree</h3>
        <dl className="kv">
          <dt>Reachable positions</dt>
          <dd className="num">{Number(stats.reachable_positions).toLocaleString("en-US")}</dd>
          <dt>Terminal positions</dt>
          <dd className="num">{Number(stats.terminal_positions).toLocaleString("en-US")}</dd>
          <dt>Complete games</dt>
          <dd className="num">{Number(stats.complete_games).toLocaleString("en-US")}</dd>
          <dt>X wins, O wins, draws</dt>
          <dd className="num">
            {Number(stats.x_wins).toLocaleString("en-US")}, {Number(stats.o_wins).toLocaleString("en-US")},{" "}
            {Number(stats.draws).toLocaleString("en-US")}
          </dd>
        </dl>
      </div>
    </div>
  );
}
