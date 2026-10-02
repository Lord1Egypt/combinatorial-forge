# N-Queens provenance

The two files in `src/nqueens/provenance/` are byte-for-byte copies of the
original independently written C++ solvers from the preceding N=18 computation.
They are preserved to distinguish the initial calculation from this repository's
fresh verification runs. The build uses the corresponding files one directory
above, with only portable bit-count wrappers added for MSVC compatibility.

Original completed run, Intel Core i7-9750H, six worker threads:

| Solver | N=18 solutions | Runtime | Original source SHA-256 |
|:--|--:|--:|:--|
| Recursive | 666,090,624 | 43.6575 s | `a25fd3ca9170760387c1a137e309bfd643e4cff2780167c45f1b2457704638cf` |
| Iterative | 666,090,624 | 43.6942 s | `1bf969dfe967d79d81e4bc1bd73ed4e0c9fa333f3f6e3b0f2d3df04dc126fd6b` |

These measurements are historical provenance, not the repository benchmark.
`scripts/verify_all.sh` recomputes every N from 1 through 18 with the active
sources and writes fresh measurements to `results/nqueens.json`.
