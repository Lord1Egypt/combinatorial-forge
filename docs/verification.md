# Verification

Run `scripts/verify_all.sh` from any directory. It configures an optimized
build with strict warnings, builds all five C++ binaries, runs CTest, performs
each exhaustive analysis, regenerates JSON and Markdown results, and checks
cross-file consistency and original-source hashes. A failed check exits
nonzero; no answer is silently substituted.

| Project | Primary computation | Independent check |
|:--|:--|:--|
| N-Queens | Recursive row-wise bitboard DFS | Iterative transposed column-wise bitboard DFS, independently partitioned; equality for every N=1..18 |
| Tic-Tac-Toe | DFS over every legal history | BFS over distinct legal states; same reachable set and count; game outcome categories sum to leaves |
| 8-Puzzle | BFS distance and predecessor tree | Replay the generated optimal path from every reachable state and check each distance decrement |
| Lights Out | Enumerate all 2^25 press patterns in Gray order | Independently solve all 2^25 boards with GF(2) elimination and check existence, exact minimum, and press image |

Additional command-line tests cover reachable and unreachable puzzle boards,
single-press and zero-press Lights Out boards, the empty-board minimax result,
and small N-Queens counts. The result checker validates histogram sums,
diameters, README headline numbers, and the preserved original SHA-256 hashes.

To repeat memory and undefined-behavior checks, configure a separate build:

```sh
cmake -S . -B build-sanitize -DCMAKE_BUILD_TYPE=Debug -DFORGE_SANITIZERS=ON
cmake --build build-sanitize --parallel
ctest --test-dir build-sanitize --output-on-failure
```

The full 2^25-board sanitizer run is optional because instrumentation is much
slower; the release build always executes the complete Lights Out check. On
this WSL2 benchmark host, LeakSanitizer cannot run under ptrace, so sanitizer
checks used `ASAN_OPTIONS=detect_leaks=0`; AddressSanitizer and UBSan remained
enabled. The complete Tic-Tac-Toe, 8-Puzzle, and Lights Out checks, plus
N-Queens through N=14, passed under those settings.
