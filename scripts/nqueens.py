#!/usr/bin/env python3
"""Command-line coordinator for the two unmodified C++ N-Queens solvers."""
import argparse
import json
import pathlib
import subprocess
import sys


def run(build, solver, n, threads):
    executable = build / ("queens_" + solver)
    if sys.platform == "win32":
        direct = build / ("queens_" + solver + ".exe")
        executable = direct if direct.exists() else build / "Release" / direct.name
    process = subprocess.run(
        [str(executable), str(n), str(threads)],
        check=True, text=True, capture_output=True,
    )
    size, count, seconds = process.stdout.strip().split()
    if int(size) != n:
        raise RuntimeError("solver returned wrong board size")
    return {"count": int(count), "seconds": float(seconds)}


def rows(build, maximum, threads):
    for n in range(1, maximum + 1):
        recursive = run(build, "recursive", n, threads)
        iterative = run(build, "iterative", n, threads)
        if recursive["count"] != iterative["count"]:
            raise RuntimeError(f"solver disagreement at N={n}")
        yield {
            "n": n,
            "solutions": recursive["count"],
            "recursive_seconds": recursive["seconds"],
            "iterative_seconds": iterative["seconds"],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["count", "verify", "benchmark"])
    parser.add_argument("n", nargs="?", type=int)
    parser.add_argument("--max-n", type=int, default=18)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--build", type=pathlib.Path, default=pathlib.Path("build-release"))
    args = parser.parse_args()
    if args.threads < 1 or not 1 <= args.max_n <= 18:
        parser.error("threads must be positive and max-n must be 1..18")
    if args.command == "count":
        if args.n is None or not 1 <= args.n <= 18:
            parser.error("count requires N in 1..18")
        recursive = run(args.build, "recursive", args.n, args.threads)
        iterative = run(args.build, "iterative", args.n, args.threads)
        if recursive["count"] != iterative["count"]:
            raise RuntimeError("solver disagreement")
        row = {"n": args.n, "solutions": recursive["count"],
               "recursive_seconds": recursive["seconds"],
               "iterative_seconds": iterative["seconds"]}
        print(json.dumps(row, sort_keys=True))
    else:
        result = list(rows(args.build, args.max_n, args.threads))
        if args.command == "benchmark":
            print("| N | Solutions | Recursive (s) | Iterative (s) |")
            print("|---:|---:|---:|---:|")
            for row in result:
                print(f"| {row['n']} | {row['solutions']} | {row['recursive_seconds']:.9f} | {row['iterative_seconds']:.9f} |")
        else:
            print(json.dumps({"verified_through": args.max_n, "rows": result}, indent=2))


if __name__ == "__main__":
    main()
