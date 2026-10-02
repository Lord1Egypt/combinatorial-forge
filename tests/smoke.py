#!/usr/bin/env python3
"""Fast independent invariants and representative CLI checks."""
import json
import pathlib
import subprocess
import sys

build = pathlib.Path(sys.argv[1])


def call(name, *args):
    path = build / name
    if sys.platform == "win32":
        direct = build / (name + ".exe")
        path = direct if direct.exists() else build / "Release" / direct.name
    return json.loads(subprocess.check_output([str(path), *args], text=True))


for n in range(1, 13):
    left_path = build / "queens_recursive"
    right_path = build / "queens_iterative"
    if sys.platform == "win32":
        left_path = build / "queens_recursive.exe"
        right_path = build / "queens_iterative.exe"
        if not left_path.exists():
            left_path = build / "Release" / left_path.name
            right_path = build / "Release" / right_path.name
    left = subprocess.check_output([str(left_path), str(n), "2"], text=True)
    right = subprocess.check_output([str(right_path), str(n), "2"], text=True)
    assert left.split()[1] == right.split()[1]

ttt = call("tictactoe", "verify")
assert ttt["complete_games"] == ttt["x_wins"] + ttt["o_wins"] + ttt["draws"]
assert ttt["perfect_play"] == "draw"
assert ttt["canonical_positions"] <= ttt["reachable_positions"]

puzzle = call("eight_puzzle", "verify")
assert sum(puzzle["histogram"]) == puzzle["reachable_states"]
assert puzzle["diameter"] == len(puzzle["histogram"]) - 1
assert call("eight_puzzle", "solve", "123456708")["moves"] == "R"
assert not call("eight_puzzle", "solve", "123456870")["solvable"]

lights = call("lights_out", "solve", "0" * 25)
assert lights["minimum_moves"] == 0 and lights["presses"] == "0" * 25
one = call("lights_out", "solve", "1100010000000000000000000")
assert one["minimum_moves"] == 1
print("smoke tests passed")
