# Benchmarks

Measured by `scripts/generate_results.py`; times are wall-clock seconds.
Counts are exact; timings vary with hardware, compiler, and system load.

## Environment

- CPU: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz (12 logical CPUs; 6 worker threads for N-Queens)
- OS: Linux-6.18.40.1-microsoft-standard-WSL2-x86_64-with-glibc2.39
- Compiler: c++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
- Build: CMake Release, `-O3`, C++17
- CMake: cmake version 3.28.3
- Python: 3.13.13
- Measurement time: 2026-10-02T07:18:35+00:00

## N-Queens

| N | Solutions | Recursive (s) | Iterative (s) |
|---:|---:|---:|---:|
| 1 | 1 | 0.000000110 | 0.000000110 |
| 2 | 0 | 0.000542190 | 0.000753830 |
| 3 | 0 | 0.001599290 | 0.000635910 |
| 4 | 2 | 0.000550440 | 0.000575960 |
| 5 | 10 | 0.000681780 | 0.000820270 |
| 6 | 4 | 0.000853050 | 0.000789800 |
| 7 | 40 | 0.000671660 | 0.000603680 |
| 8 | 92 | 0.000603350 | 0.000624800 |
| 9 | 352 | 0.000691350 | 0.000757350 |
| 10 | 724 | 0.000709060 | 0.000829070 |
| 11 | 2,680 | 0.000982080 | 0.000879340 |
| 12 | 14,200 | 0.001558810 | 0.001647470 |
| 13 | 73,712 | 0.004854850 | 0.004919200 |
| 14 | 365,596 | 0.023108600 | 0.027896900 |
| 15 | 2,279,184 | 0.151311000 | 0.164919000 |
| 16 | 14,772,512 | 0.908554000 | 0.963792000 |
| 17 | 95,815,104 | 6.818680000 | 7.184750000 |
| 18 | 666,090,624 | 49.674600000 | 57.089700000 |

The two N=18 measurements were run sequentially. Each C++ binary measures
its own compute time with `std::chrono::steady_clock`.

## Other exhaustive runs

| Project | Wall time (s) |
|:--|--:|
| Tic-Tac-Toe | 0.020809 |
| 8-Puzzle | 0.305374 |
| Lights Out 5×5 | 1.602564 |

The earlier N=18 provenance measurements are recorded separately in
[`docs/provenance.md`](provenance.md).

## Shared engine API smoke benchmark (2026-10-02)

On the same WSL2 host above, GCC 13.3.0 `-O3` and the checked-in Emscripten
6.0.10 WASM build each handled 20 warm `chess.perft` requests from the initial
position at depth 4. The native binary called `forge::api::handle` in-process;
Node 25.8.1 called the WASM `forge_call` export after module initialization.
Both returned 197,281 nodes and 1,576 captures.

| Engine | 20 calls | Per call |
|:--|--:|--:|
| Native C++ | 452.006 ms | 22.600 ms |
| WASM in Node | 416.050 ms | 20.802 ms |

The observed WASM/native ratio was 0.92 for this one warm batch. It excludes
process startup, network/database work, and browser scheduling, so it is a
representative engine comparison rather than a deployment throughput claim.
