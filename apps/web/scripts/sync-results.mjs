// Derives src/generated/results.json from the canonical machine-readable results in ../../results.
// Presentation reads only this derived bundle; nothing is typed in by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "results");
const target = join(here, "..", "src", "generated", "results.json");

if (!existsSync(source)) {
  if (existsSync(target)) {
    console.log("results: canonical directory not present; keeping committed copy");
    process.exit(0);
  }
  throw new Error("results/ not found and no committed copy exists");
}
const read = (name) => JSON.parse(readFileSync(join(source, name), "utf8"));
const bundle = {
  nqueens: read("nqueens.json"),
  tictactoe: read("tictactoe.json"),
  eight_puzzle: read("eight_puzzle.json"),
  lights_out: read("lights_out.json"),
  environment: read("environment.json"),
  source_hashes: read("source_hashes.json"),
};
mkdirSync(dirname(target), { recursive: true });
const next = JSON.stringify(bundle, null, 2) + "\n";
if (!existsSync(target) || readFileSync(target, "utf8") !== next) writeFileSync(target, next);
console.log("results: bundle written");
