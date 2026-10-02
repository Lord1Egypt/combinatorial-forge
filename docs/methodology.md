# Methodology

Each project chooses a representation that matches the structure of its finite
space. All reported counts come from executing the programs in this repository.

## N-Queens: bitboards, branch pruning, symmetry

At each depth, three 32-bit masks encode occupied lines: columns (or rows in
the transposed implementation) and the two diagonal attack directions. Legal
choices are `board_mask & ~(occupied | left | right)`. Extracting the least
significant set bit visits only legal branches; a branch with no legal bit ends
immediately. This is depth-first branch pruning, with O(N) stack memory per
worker. For the final row, population count replaces individual leaf calls.

Reflecting the first placement pairs branches. A placement on the center line
of an odd board has weight one; every other first placement has weight two.
The recursive and iterative implementations generate separate task sets and
use independent traversals. Workers claim prefix tasks via an atomic counter.
No thread mutates another worker's search state. Worst-case search is
exponential, but the masks make a visited node constant work.

## Tic-Tac-Toe: game tree, state graph, minimax

The depth-first game-tree traversal counts histories, including distinct move
orders reaching the same board. A base-3 board code indexes visited states,
so reachable positions and terminal positions count each board once. The
eight square symmetries are applied to each board; the smallest encoding is
its canonical representative. A separate breadth-first state-graph traversal
checks the set of unique reachable boards. Memoized minimax evaluates X wins
as +1, O wins as -1, draws as 0, and chooses the optimal move for the side
to play. With only 3^9 possible encodings, fixed-size arrays suffice.

## 8-Puzzle: state graph and shortest paths

Lehmer rank maps each permutation of 0..8 into a dense index in `[0, 9!)`.
Breadth-first search from the goal visits each reachable state once and records
its distance and a predecessor toward the goal. BFS's layer order proves the
stored distance is the shortest possible. The distance histogram and diameter
come from those layers. Every generated solution is replayed from its start
board, checking each move, predecessor, strictly decreasing distance, and
arrival at the goal. Space is O(9!); each state has at most four neighbors.

## Lights Out: binary linear algebra and exhaustive enumeration

A 25-bit vector denotes presses; another denotes lit cells. The toggle rule
is a 25×25 matrix over GF(2), so solving a board is solving `A x = b`.
Gauss-Jordan elimination computes rank, consistency constraints, one
particular solution, and a nullspace basis. Enumerating the affine nullspace
finds a minimum-Hamming-weight press vector. Independently, Gray-code
enumeration walks all 2^25 press patterns: consecutive patterns differ by one
press, so their board images update with one XOR. A byte per board stores the
minimum weight seen. The program checks every one of the 2^25 boards against
the linear-algebra method, including unsolvable boards. Memory is O(2^25)
bytes for the exhaustive table, plus small fixed-size matrices.

## Results and timing

The mathematical results are integers and distributions; they are invariant
under compiler and machine choice. Implementation runtimes are measurements,
not mathematical properties. The generator stores raw JSON and writes Markdown
tables from that JSON. Wall-clock timings are necessarily load dependent.
