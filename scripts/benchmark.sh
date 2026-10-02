#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="${1:-$root/build-release}"
python3 "$root/scripts/generate_results.py" --build "$build" --max-n 18
python3 "$root/tests/check_results.py"
cat "$root/docs/benchmarks.md"
