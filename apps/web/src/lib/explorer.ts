import type { Client } from "@libsql/client";
import { engineCall } from "./engine";
import { ApiError } from "./http";
import { canonicalResult, results } from "./results";

const str = (v: unknown) => String(v);
const num = (v: unknown) => Number(v);
const HEX32 = /^[0-9a-f]{32}$/;
const EPD = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])$/;

export async function chessLayers(db: Client) {
  const r = await db.execute(
    "SELECT run_id, ply, unique_positions, move_sequences, status FROM chess_layers ORDER BY run_id, ply",
  );
  return r.rows.map((row) => ({
    run_id: str(row.run_id),
    ply: num(row.ply),
    unique_positions: num(row.unique_positions),
    move_sequences: row.move_sequences === null ? null : num(row.move_sequences),
    status: str(row.status),
  }));
}

export async function storedChessPosition(db: Client, id: string) {
  if (!HEX32.test(id))
    throw new ApiError(400, "invalid_id", "position id must be 32 lowercase hex characters");
  const p = await db.execute({
    sql: "SELECT position_id, epd, first_ply, legal_moves FROM chess_positions WHERE position_id = ?",
    args: [id],
  });
  if (p.rows.length === 0) throw new ApiError(404, "not_stored", "position is not in the stored dataset");
  const children = await db.execute({
    sql: "SELECT child_id, uci FROM chess_edges WHERE parent_id = ? ORDER BY uci",
    args: [id],
  });
  const parents = await db.execute({
    sql: "SELECT parent_id, uci FROM chess_edges WHERE child_id = ? ORDER BY parent_id LIMIT 100",
    args: [id],
  });
  const row = p.rows[0];
  return {
    source: "stored",
    position_id: str(row.position_id),
    epd: str(row.epd),
    first_ply: num(row.first_ply),
    legal_moves: num(row.legal_moves),
    children: children.rows.map((c) => ({ id: str(c.child_id), uci: str(c.uci) })),
    parents: parents.rows.map((c) => ({ id: str(c.parent_id), uci: str(c.uci) })),
    parents_truncated: parents.rows.length === 100,
    note: "Parents are listed only for stored plies; transpositions mean a position can have many parents.",
  };
}

/** Always available: computed on demand by the shared engine, clearly labelled as not stored. */
export async function computedChessPosition(epd: string) {
  if (!EPD.test(epd))
    throw new ApiError(
      400,
      "invalid_epd",
      "epd must be a 4-field position (placement, side, castling, en-passant)",
    );
  try {
    const p = await engineCall<{
      id: string;
      epd: string;
      side_to_move: string;
      in_check: boolean;
      legal_moves: number;
      children: { uci: string; id: string; epd: string }[];
    }>("chess.position", { epd });
    return {
      source: "computed",
      position_id: p.id,
      epd: p.epd,
      side_to_move: p.side_to_move,
      in_check: p.in_check,
      legal_moves: p.legal_moves,
      children: p.children,
    };
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_position",
      error instanceof Error ? error.message.replace(/^engine: /, "") : "invalid position",
    );
  }
}

function boardParam(search: URLSearchParams, fallback: string, pattern: RegExp, what: string): string {
  const board = search.get("board") ?? fallback;
  if (!pattern.test(board)) throw new ApiError(400, "invalid_board", `${what}`);
  return board;
}

/** Dispatches /api/v1/explorer/:problem/... Everything is derived from canonical results or the shared engine. */
export async function explore(
  db: () => Promise<Client>,
  problem: string,
  slug: string[],
  search: URLSearchParams,
): Promise<unknown> {
  switch (problem) {
    case "nqueens": {
      const n = search.get("n");
      if (n === null) {
        return {
          verified_through: results.nqueens.verified_through,
          verification: "recursive and iterative implementations agree for every N (see /verification)",
          rows: results.nqueens.rows.map((r) => ({
            n: r.n,
            solutions: r.solutions,
            recursive_seconds: r.recursive_seconds,
            iterative_seconds: r.iterative_seconds,
          })),
        };
      }
      if (!/^\d{1,2}$/.test(n)) throw new ApiError(400, "invalid_n", "n must be an integer");
      const row = results.nqueens.rows.find((r) => r.n === Number(n));
      if (!row) throw new ApiError(404, "not_computed", "no verified result for this N");
      const examples =
        row.n <= 16 && row.solutions > 0
          ? await engineCall("nqueens.examples", { n: row.n, limit: 4 })
          : null;
      return {
        ...row,
        algorithm: ["recursive bitmask", "iterative bitmask"],
        verification: "two independent implementations",
        examples,
      };
    }
    case "tictactoe": {
      const board = boardParam(search, "---------", /^[xo-]{9}$/, "board must be 9 characters of x, o or -");
      return { stats: canonicalResult("tictactoe"), position: await engineCall("ttt.position", { board }) };
    }
    case "eight_puzzle": {
      const board = boardParam(
        search,
        "123456780",
        /^[0-8]{9}$/,
        "board must be a permutation of 0-8 (0 is the blank)",
      );
      try {
        return {
          stats: canonicalResult("eight_puzzle"),
          solution: await engineCall("puzzle8.solve", { board }),
        };
      } catch {
        throw new ApiError(400, "invalid_board", "board must be a permutation of 0-8");
      }
    }
    case "lights_out": {
      const board = boardParam(
        search,
        "0".repeat(24) + "1",
        /^[01]{25}$/,
        "board must be 25 characters of 0 or 1",
      );
      return { stats: canonicalResult("lights_out"), solution: await engineCall("lights.solve", { board }) };
    }
    case "chess": {
      if (slug[0] === "layers")
        return {
          layers: await chessLayers(await db()),
          note: "unique positions and move sequences are different metrics",
        };
      if (slug[0] === "position" && slug[1]) return storedChessPosition(await db(), slug[1]);
      const epd = search.get("epd");
      if (epd) return computedChessPosition(epd);
      return computedChessPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
    }
    default:
      throw new ApiError(404, "unknown_problem", "unknown problem");
  }
}
