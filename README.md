<p align="center"><img src="assets/banner.svg" alt="Combinatorial Forge — exact answers from exhaustive, reproducible computation" width="100%"></p>

# Combinatorial Forge

**Exact solvers and exhaustive verifiers for classic combinatorial puzzles and finite games.**

[![CI](https://github.com/Lord1Egypt/combinatorial-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Lord1Egypt/combinatorial-forge/actions/workflows/ci.yml)
[![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C.svg)](CMakeLists.txt)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

This repository puts four finite-search techniques side by side: bitboards,
game trees, shortest-path graph search, and linear algebra over GF(2). Each
project includes an exact solver, an exhaustive analysis, a verification path,
and a command-line interface. Counts are computed from source; no published
answer is embedded in an implementation.

## Projects and verified results

<!-- BEGIN VERIFIED RESULTS -->
| Project | Exhaustive result | Verification |
|:--|:--|:--|
| N-Queens | N=18: **666,090,624** solutions | Two independent bitboard traversals; N=1–18 |
| Tic-Tac-Toe | **5,478** positions; **255,168** games | Game tree vs. state graph |
| 8-Puzzle | **181,440** states; diameter **31** | Replay every optimal path |
| Lights Out 5×5 | **8,388,608** solvable of **33,554,432** boards; max minimum **15** | Gray enumeration vs. GF(2) for every board |
<!-- END VERIFIED RESULTS -->

The full generated [N-Queens timing table and puzzle distributions](results/tables.md)
and machine-readable [JSON files](results/) contain every reported value.
Fresh measurements and the exact build environment are in
[benchmarks](docs/benchmarks.md); final solver SHA-256 hashes are in
[`results/source_hashes.json`](results/source_hashes.json).

| Project | Technique | Core data structure | Typical query |
|:--|:--|:--|:--|
| N-Queens | Branch pruning and reflection symmetry | 32-bit attack masks | Count all placements |
| Tic-Tac-Toe | Exhaustive histories and minimax | Base-3 indexed boards | Play perfectly |
| 8-Puzzle | BFS and shortest paths | Lehmer-ranked permutations | Find an optimal move sequence |
| Lights Out 5×5 | GF(2) elimination and exhaustive cross-check | 25-bit press and board vectors | Find a minimum-press solution |

The **mathematical result** is an exact integer or distribution. The
**implementation** is the reproducible algorithm and source. A **benchmark**
is a wall-time observation on a particular machine; it can vary between runs.

## Build

Requirements: a C++17 compiler, CMake 3.16+, Python 3 for verification scripts,
and a shell for the convenience scripts. The C++ binaries also build with MSVC;
the shell scripts target POSIX systems. There are no third-party libraries.

```sh
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release --parallel
ctest --test-dir build-release --output-on-failure
```

The examples below assume a POSIX shell. On Windows, use the corresponding
`.exe` paths and the CMake configuration's output directory.

## Use the solvers

```sh
# N-Queens: cross-checked count, all-N verification, or timing table
python3 scripts/nqueens.py count 18 --build build-release --threads 6
python3 scripts/nqueens.py verify --max-n 18 --build build-release
python3 scripts/nqueens.py benchmark --max-n 18 --build build-release

# Tic-Tac-Toe: full game tree or interactive perfect-play opponent
./build-release/tictactoe analyze
./build-release/tictactoe play X

# 8-Puzzle: 0 is the blank; moves describe movement of the blank
./build-release/eight_puzzle analyze
./build-release/eight_puzzle solve 123456708

# Lights Out: 25 row-major bits, 1 means lit or pressed
./build-release/lights_out analyze
./build-release/lights_out solve 1100010000000000000000000
```

Example output from the solution CLIs:

```text
$ ./build-release/eight_puzzle solve 123456708
{"solvable":true,"distance":1,"moves":"R"}
$ ./build-release/lights_out solve 1100010000000000000000000
{"solvable":true,"minimum_moves":1,"presses":"1000000000000000000000000"}
```

For Tic-Tac-Toe, the interactive display uses squares 1–9; enter an empty
square's number. Invalid or unreachable boards are rejected by the puzzle
CLIs. Tic-Tac-Toe game statistics count distinct move histories separately
from distinct board positions.

## Why these algorithms

- **N-Queens:** each placed queen updates three bitboards; only legal bits are
  explored. Reflecting the first placement halves most top-level work.
  Independent recursive and iterative solvers cross-check every N=1–18.
- **Tic-Tac-Toe:** the complete game tree counts games, while a separate state
  graph counts positions. Eight rotations/reflections yield symmetry classes;
  memoized minimax chooses perfect moves.
- **8-Puzzle:** BFS from the goal proves every stored path optimal. A dense
  permutation rank indexes arrays, and every output path is replayed.
- **Lights Out:** row reduction finds the affine solution set. An exhaustive
  Gray-code sweep independently checks solvability and minimum presses for
  every 5×5 board.

The spaces differ sharply: N-Queens has an exponential search tree;
Tic-Tac-Toe fits inside 3^9 board encodings; the 8-Puzzle fits inside 9!
permutation slots; Lights Out has 2^25 boards and press patterns. See
[methodology](docs/methodology.md) for invariants and complexity details and
[verification](docs/verification.md) for the independent checks.

## Reproduce the published artifacts

```sh
scripts/verify_all.sh
# Or rerun the timing suite against an existing optimized build:
scripts/benchmark.sh
```

`verify_all.sh` rebuilds, tests, runs all four exhaustive suites, regenerates
`results/*.json` and the Markdown tables, then checks the README and
provenance hashes. It takes longer than the smoke tests because N=18 is counted
twice. Times are regenerated, so a local run may change timing fields while
leaving exact counts unchanged. The two original N-Queens sources and their
earlier verified run are preserved in [provenance](docs/provenance.md).

## Repository map

```text
assets/          lightweight local banner
src/             four C++17 projects; N-Queens original sources in provenance/
tests/           smoke tests and generated-result consistency checks
scripts/         N-Queens CLI, exhaustive runner, benchmark runner
results/         generated JSON plus full Markdown tables
docs/            methodology, verification, environment, provenance
.github/         build and test automation
```

## Limits and contributions

N-Queens is intentionally limited to the exhaustively verified N=1–18 range;
larger N take much more time and eventually exceed the 64-bit result type.
Timings depend on CPU, build
flags, and competing load. The Lights Out exhaustive table uses roughly 32 MiB
plus process overhead. CI runs fast tests; the full N=18 suite is available via
`scripts/verify_all.sh`.

Contributions are welcome as focused issues or pull requests. Include a
reproducer, an explanation of the algorithm or invariant, and updated generated
results when a mathematical output changes. Run the build and tests before
submitting.

Licensed under [MIT](LICENSE).
