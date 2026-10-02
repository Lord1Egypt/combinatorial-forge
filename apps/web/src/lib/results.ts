import bundle from "@/generated/results.json";

export interface NQueensRow {
  n: number;
  solutions: number;
  recursive_seconds: number;
  iterative_seconds: number;
}

/** Canonical verified results, derived at build time from results/*.json. */
export const results = bundle as unknown as {
  nqueens: { rows: NQueensRow[]; verified_through: number; worker_threads: number };
  tictactoe: Record<string, number | string | boolean>;
  eight_puzzle: {
    reachable_states: number;
    diameter: number;
    histogram: number[];
    runtime_seconds: number;
    all_paths_replayed: boolean;
  };
  lights_out: {
    total_states: number;
    solvable_states: number;
    unsolvable_states: number;
    rank: number;
    nullity: number;
    maximum_minimum_moves: number;
    minimum_move_distribution: number[];
    runtime_seconds: number;
    every_board_cross_checked: boolean;
  };
  environment: Record<string, string | number>;
  source_hashes: Record<string, string>;
};

export function canonicalResult(problem: string): unknown {
  switch (problem) {
    case "nqueens":
      return results.nqueens;
    case "tictactoe":
      return results.tictactoe;
    case "eight_puzzle":
      return results.eight_puzzle;
    case "lights_out":
      return results.lights_out;
    default:
      return null;
  }
}

export const fmt = (n: number): string => n.toLocaleString("en-US");
