#!/usr/bin/env python3
"""Validate generated artifacts against one another, without answer constants."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
results = root / "results"
sys.path.insert(0, str(root / "scripts"))
from generate_results import markdown  # noqa: E402


def read(name):
    return json.loads((results / name).read_text())


queens = read("nqueens.json")
ttt = read("tictactoe.json")
puzzle = read("eight_puzzle.json")
lights = read("lights_out.json")
source_hashes = read("source_hashes.json")
assert [row["n"] for row in queens["rows"]] == list(range(1, queens["verified_through"] + 1))
assert queens["verified_through"] == 18
assert ttt["complete_games"] == ttt["x_wins"] + ttt["o_wins"] + ttt["draws"]
assert ttt["canonical_positions"] <= ttt["reachable_positions"]
assert ttt["canonical_terminal_positions"] <= ttt["terminal_positions"]
assert puzzle["all_paths_replayed"] and sum(puzzle["histogram"]) == puzzle["reachable_states"]
assert len(puzzle["histogram"]) - 1 == puzzle["diameter"]
assert lights["every_board_cross_checked"]
assert lights["solvable_states"] + lights["unsolvable_states"] == lights["total_states"]
assert sum(lights["minimum_move_distribution"]) == lights["solvable_states"]
assert len(lights["minimum_move_distribution"]) - 1 == lights["maximum_minimum_moves"]

readme = (root / "README.md").read_text()
overview, _, tables = markdown(queens["rows"], ttt, puzzle, lights)
assert (results / "tables.md").read_text() == tables
generated_readme = readme.split("<!-- BEGIN VERIFIED RESULTS -->", 1)[1].split(
    "<!-- END VERIFIED RESULTS -->", 1)[0].strip()
assert generated_readme == overview
for value in (f"{queens['rows'][-1]['solutions']:,}", f"{ttt['complete_games']:,}",
              f"{puzzle['reachable_states']:,}", f"{lights['solvable_states']:,}"):
    assert value in generated_readme, f"README missing generated number {value}"

expected = {
    "queens_recursive.cpp": "a25fd3ca9170760387c1a137e309bfd643e4cff2780167c45f1b2457704638cf",
    "queens_iterative.cpp": "1bf969dfe967d79d81e4bc1bd73ed4e0c9fa333f3f6e3b0f2d3df04dc126fd6b",
}
for filename, digest in expected.items():
    actual = hashlib.sha256((root / "src" / "nqueens" / "provenance" / filename).read_bytes()).hexdigest()
    assert actual == digest, f"provenance hash changed: {filename}"
for path, digest in source_hashes.items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == digest
print("generated result and provenance checks passed")
