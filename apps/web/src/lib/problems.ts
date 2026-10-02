export type ProblemId = "nqueens" | "tictactoe" | "eight_puzzle" | "lights_out" | "chess";
export type ResultStatus = "complete" | "partial" | "research";

export interface ProblemInfo {
  id: ProblemId;
  title: string;
  status: ResultStatus;
  headline: string;
  summary: string;
  method: string;
}

/** Static descriptive metadata only. Every number shown on the site is derived from results/*.json or the database. */
export const PROBLEMS: ProblemInfo[] = [
  {
    id: "nqueens",
    title: "N-Queens",
    status: "complete",
    headline: "Exact counts, verified through N=18",
    summary:
      "Place N non-attacking queens on an N×N board. Two independent implementations agree for every N from 1 to 18.",
    method:
      "Bitmask backtracking with first-row symmetry reduction; distributed runs partition by queen prefixes.",
  },
  {
    id: "tictactoe",
    title: "Tic-Tac-Toe",
    status: "complete",
    headline: "The complete game tree",
    summary: "Every reachable position and every complete game, with minimax values under perfect play.",
    method:
      "Exhaustive depth-first enumeration with memoised minimax and dihedral symmetry canonicalisation.",
  },
  {
    id: "eight_puzzle",
    title: "8-Puzzle",
    status: "complete",
    headline: "Every reachable state, solved optimally",
    summary:
      "Breadth-first distances from the goal over all reachable states, with optimal paths replayed and checked.",
    method: "Breadth-first search over permutation ranks; every optimal path is replayed move by move.",
  },
  {
    id: "lights_out",
    title: "Lights Out 5×5",
    status: "complete",
    headline: "All 2²⁵ boards classified",
    summary:
      "Solvability and minimum press counts for every board, from linear algebra over GF(2) cross-checked exhaustively.",
    method: "Gaussian elimination over GF(2) plus Gray-code enumeration of all press patterns.",
  },
  {
    id: "chess",
    title: "Chess",
    status: "research",
    headline: "Research computation — not solved",
    summary:
      "Resumable, verified enumeration of positions and move sequences by depth. Chess is nowhere near solved; this module counts what has actually been computed.",
    method:
      "Legal move generation with canonical position identity; partitioned perft jobs and per-ply unique-position layers.",
  },
];

export const problemById = (id: string): ProblemInfo | undefined => PROBLEMS.find((p) => p.id === id);
