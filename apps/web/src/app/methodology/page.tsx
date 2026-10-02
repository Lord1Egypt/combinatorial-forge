import type { Metadata } from "next";

export const metadata: Metadata = { title: "Methodology" };

export default function Methodology() {
  return (
    <>
      <h1>Methodology</h1>
      <p className="lede">
        Each problem uses the representation that fits its finite space. All reported counts come from running
        the code in the repository.
      </p>
      <h2>N-Queens</h2>
      <p>
        Three bit masks track occupied columns and both diagonal directions, so legal squares are found with
        one mask operation and only legal branches are visited. Reflecting the first row halves the work for
        the baseline counts. Distributed runs instead split the tree by queen prefix: each work unit counts
        the completions of one fixed placement of the first rows, so the results add up with no symmetry
        bookkeeping.
      </p>
      <h2>Tic-Tac-Toe</h2>
      <p>
        A depth-first walk of every legal history counts games, including different move orders that reach the
        same board. A base-3 code indexes boards so positions are counted once, and the eight square
        symmetries give canonical representatives. Minimax values come from the same table.
      </p>
      <h2>8-Puzzle</h2>
      <p>
        Breadth-first search from the goal over permutation ranks gives every state its exact distance.
        Because the search proceeds layer by layer, the stored distance is provably the shortest. Each
        generated solution was replayed from its starting board.
      </p>
      <h2>Lights Out 5×5</h2>
      <p>
        Pressing a light toggles a cross of five cells, which is a 25×25 linear system over GF(2). Elimination
        gives solvability and a solution space of four press patterns per solvable board; the shortest is the
        answer. A second, brute-force traversal of all 2²⁵ press patterns checks every board.
      </p>
      <h2>Chess</h2>
      <p>
        Positions come from a legal move generator with full castling, en passant and promotion rules. A
        position is identified by piece placement, side to move, castling rights, and an en-passant square
        only when a legal en-passant capture exists. Move counters are not part of identity. Two numbers are
        reported and never confused: move sequences (perft) count paths, and distinct positions count
        identities, so transpositions are counted once. Draw rules such as repetition and the fifty-move rule
        are not applied; every legal move is followed.
      </p>
      <h2>Distributed work units</h2>
      <p>
        A job is defined by its problem, versions, parameters, root state, partition, range, depth and
        algorithm. The job identifier is the SHA-256 of that definition in canonical JSON, so the same work
        always has the same identity, in the native tool and on the server. Long jobs are split into resumable
        steps whose checkpoints can be saved and continued by any worker.
      </p>
      <h2>Measurements</h2>
      <p>
        Results are exact integers and distributions, independent of compiler and machine. Timings are
        observations from one run on one machine and are labelled as such.
      </p>
    </>
  );
}
