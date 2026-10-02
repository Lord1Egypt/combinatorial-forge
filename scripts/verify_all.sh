#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="${1:-$root/build-release}"
cmake -S "$root" -B "$build" -DCMAKE_BUILD_TYPE=Release -DFORGE_WARNINGS_AS_ERRORS=ON
cmake --build "$build" --parallel
ctest --test-dir "$build" --output-on-failure
python3 "$root/scripts/generate_results.py" --build "$build" --max-n 18
python3 "$root/tests/check_results.py"
