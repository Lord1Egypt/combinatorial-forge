import type { Client, InStatement } from "@libsql/client";
import { engineCall } from "./engine";
import { ApiError } from "./http";
import { isObject, needInt } from "./validate";

const HEX32 = /^[0-9a-f]{32}$/;
const EPD = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])$/;
const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/;
export const MAX_IMPORT_ROWS = 2000;

/** Imports chess research rows produced by a native run. Every position id is recomputed from its EPD. */
export async function importChess(
  db: Client,
  body: Record<string, unknown>,
): Promise<{ positions: number; edges: number; layers: number }> {
  const positions = (body.positions ?? []) as unknown[];
  const edges = (body.edges ?? []) as unknown[];
  const layers = (body.layers ?? []) as unknown[];
  for (const list of [positions, edges, layers])
    if (!Array.isArray(list) || list.length > MAX_IMPORT_ROWS)
      throw new ApiError(400, "too_many_rows", `at most ${MAX_IMPORT_ROWS} rows per table per request`);
  const statements: InStatement[] = [];
  for (const raw of positions) {
    if (
      !isObject(raw) ||
      typeof raw.position_id !== "string" ||
      !HEX32.test(raw.position_id) ||
      typeof raw.epd !== "string" ||
      !EPD.test(raw.epd)
    )
      throw new ApiError(400, "invalid_position", "malformed position row");
    const checked = await engineCall<{ id: string; legal_moves: number }>("chess.position", { epd: raw.epd });
    if (checked.id !== raw.position_id)
      throw new ApiError(400, "id_mismatch", "position_id does not match its EPD");
    statements.push({
      sql: "INSERT OR IGNORE INTO chess_positions (position_id, epd, first_ply, legal_moves) VALUES (?, ?, ?, ?)",
      args: [raw.position_id, raw.epd, needInt(raw.first_ply, "first_ply", 0, 64), checked.legal_moves],
    });
  }
  for (const raw of edges) {
    if (
      !isObject(raw) ||
      typeof raw.parent_id !== "string" ||
      !HEX32.test(raw.parent_id) ||
      typeof raw.child_id !== "string" ||
      !HEX32.test(raw.child_id) ||
      typeof raw.uci !== "string" ||
      !UCI.test(raw.uci)
    )
      throw new ApiError(400, "invalid_edge", "malformed edge row");
    statements.push({
      sql: "INSERT OR IGNORE INTO chess_edges (parent_id, child_id, uci) VALUES (?, ?, ?)",
      args: [raw.parent_id, raw.child_id, raw.uci],
    });
  }
  for (const raw of layers) {
    if (
      !isObject(raw) ||
      typeof raw.run_id !== "string" ||
      !/^[0-9a-f]{8,64}$/.test(raw.run_id) ||
      (raw.status !== "complete" && raw.status !== "partial")
    )
      throw new ApiError(400, "invalid_layer", "malformed layer row");
    statements.push({
      sql: "INSERT OR REPLACE INTO chess_layers (run_id, ply, unique_positions, move_sequences, status) VALUES (?, ?, ?, ?, ?)",
      args: [
        raw.run_id,
        needInt(raw.ply, "ply", 0, 64),
        needInt(raw.unique_positions, "unique_positions", 0, Number.MAX_SAFE_INTEGER),
        raw.move_sequences === null || raw.move_sequences === undefined
          ? null
          : needInt(raw.move_sequences, "move_sequences", 0, Number.MAX_SAFE_INTEGER),
        raw.status,
      ],
    });
  }
  if (statements.length > 0) await db.batch(statements, "write");
  return { positions: positions.length, edges: edges.length, layers: layers.length };
}
