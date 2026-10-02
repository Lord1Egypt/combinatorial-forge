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

The development branch also contains a [web explorer](apps/web), a native
`forge` worker, and a distributed job service. Native and browser compute use
the same C++ engine; the browser runs its WebAssembly build only after a visitor
presses **Start**. Work can be checkpointed and resumed. Public submissions are
stored as unverified until independent matching work or a trusted recomputation
settles them. Local development uses SQLite; an online deployment needs a
server-side libSQL database. See [deployment](docs/deployment.md) and
[security](docs/security.md).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLord1Egypt%2Fcombinatorial-forge%2Ftree%2Ffeature%2Fdistributed-web&root-directory=apps%2Fweb&env=TURSO_DATABASE_URL%2CTURSO_AUTH_TOKEN%2CADMIN_TOKEN&envDescription=Use%20your%20own%20libSQL%20database%20and%20a%20new%20admin%20token&envLink=https%3A%2F%2Fgithub.com%2FLord1Egypt%2Fcombinatorial-forge%2Fblob%2Ffeature%2Fdistributed-web%2Fdocs%2Fdeployment.md)

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
the shell scripts target POSIX systems. The original four solvers have no
third-party dependencies; `forge` builds with a vendored SQLite library.

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
engine/          shared deterministic C++ engine and chess core
cli/             native forge worker, SQLite store, snapshot and local explorer
wasm/            browser/server entry point for the shared engine
apps/web/        Next.js site, libSQL API, browser compute and tests
database/        versioned migrations and protocol fixtures
tests/           smoke tests and generated-result consistency checks
scripts/         N-Queens CLI, exhaustive runner, benchmark runner
results/         generated JSON plus full Markdown tables
docs/            methodology, verification, environment, provenance
.github/         build and test automation
```

## Limits and contributions

Chess is a **research computation**, limited to explicitly completed finite
depths. A depth-limited move-sequence count is different from a count of unique
positions, and neither solves chess. See [chess methodology](docs/chess.md).

The shared-engine development workflow is:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
cd apps/web && npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

`npm run verify:wasm` compares the checked-in WASM binary with the native
`build/forge` binary. To rebuild WASM from source, install Emscripten and run
`scripts/build_wasm.sh` from the repository root. The web API migrates its
database on first access; administration, snapshots, and job creation use the
authenticated API. The native CLI supports local export, import, and merge.

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
