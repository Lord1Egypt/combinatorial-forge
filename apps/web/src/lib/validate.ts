import type { JsonValue } from "./canonical";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const NQUEENS_SOLVER = "nqueens-bitmask-prefix/1";
export const CHESS_SOLVER = "chess-perft/1";
/** The engine supports N up to 27, but job counts are carried as JS safe integers, which stays exact through N = 24. */
export const MAX_NQUEENS_N = 24;
export const MAX_CHESS_DEPTH = 8;

export type Obj = { [key: string]: JsonValue };

export interface JobDefinition extends Obj {
  algorithm: string;
  depth: number | null;
  parameters: Obj;
  partition: Obj;
  problem: string;
  problem_version: string;
  range: null;
  root_state: Obj | null;
  solver_version: string;
}

const KEYS = [
  "algorithm",
  "depth",
  "parameters",
  "partition",
  "problem",
  "problem_version",
  "range",
  "root_state",
  "solver_version",
];
const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/;
const EPD = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])$/;

export function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function needInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new ValidationError(`${what} must be an integer between ${min} and ${max}`);
  return value;
}

function exactKeys(value: unknown, keys: string[], what: string): Obj {
  if (!isObject(value)) throw new ValidationError(`${what} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((k, i) => k !== [...keys].sort()[i]))
    throw new ValidationError(`${what} must have exactly the fields: ${keys.join(", ")}`);
  return value;
}

/** Validates a job definition; mirrors forge::jobs::validate in the C++ engine. */
export function validateJobDefinition(input: unknown): JobDefinition {
  const def = exactKeys(input, KEYS, "job definition");
  if (def.problem_version !== "1") throw new ValidationError("unsupported problem_version");
  if (def.range !== null) throw new ValidationError("range must be null");
  if (typeof def.problem !== "string") throw new ValidationError("problem must be a string");
  if (def.problem === "nqueens") {
    if (def.solver_version !== NQUEENS_SOLVER || def.algorithm !== "bitmask-prefix")
      throw new ValidationError("unsupported nqueens solver");
    if (def.root_state !== null || def.depth !== null)
      throw new ValidationError("root_state and depth must be null for nqueens");
    const params = exactKeys(def.parameters, ["n"], "parameters");
    const n = needInt(params.n, "n", 1, MAX_NQUEENS_N);
    const partition = exactKeys(def.partition, ["prefix"], "partition");
    const prefix = partition.prefix;
    if (!Array.isArray(prefix) || prefix.length > n)
      throw new ValidationError("prefix must be an array of at most n columns");
    const columns = prefix.map((c) => needInt(c, "prefix column", 0, n - 1));
    columns.forEach((column, row) => {
      for (let earlier = 0; earlier < row; earlier++) {
        const other = columns[earlier];
        if (other === column || Math.abs(other - column) === row - earlier)
          throw new ValidationError("prefix has attacking queens");
      }
    });
  } else if (def.problem === "chess") {
    if (def.solver_version !== CHESS_SOLVER || def.algorithm !== "perft")
      throw new ValidationError("unsupported chess solver");
    const params = def.parameters;
    if (!isObject(params) || Object.keys(params).length !== 0)
      throw new ValidationError("chess parameters must be {}");
    const root = exactKeys(def.root_state, ["epd"], "root_state");
    if (typeof root.epd !== "string" || !EPD.test(root.epd))
      throw new ValidationError("root_state.epd is malformed");
    const partition = exactKeys(def.partition, ["path"], "partition");
    const path = partition.path;
    if (!Array.isArray(path) || path.length > 16 || path.some((m) => typeof m !== "string" || !UCI.test(m)))
      throw new ValidationError("partition.path must be at most 16 UCI moves");
    needInt(def.depth, "depth", 0, MAX_CHESS_DEPTH);
  } else {
    throw new ValidationError("unknown problem");
  }
  return def as JobDefinition;
}

const CHESS_RESULT_KEYS = ["captures", "castles", "en_passant", "nodes", "promotions"];

/** Structural and plausibility checks for a submitted result; correctness is decided by redundancy. */
export function validateResult(def: JobDefinition, input: unknown): Obj {
  if (def.problem === "nqueens") {
    const result = exactKeys(input, ["solutions"], "result");
    const n = (def.parameters as { n: number }).n;
    const remaining = n - (def.partition.prefix as number[]).length;
    needInt(result.solutions, "solutions", 0, Math.min(Number.MAX_SAFE_INTEGER, n ** Math.max(remaining, 0)));
    return result;
  }
  const result = exactKeys(input, CHESS_RESULT_KEYS, "result");
  const depth = def.depth as number;
  const maxNodes = depth === 0 ? 1 : Math.min(Number.MAX_SAFE_INTEGER, 218 ** depth);
  const nodes = needInt(result.nodes, "nodes", depth === 0 ? 1 : 0, maxNodes);
  for (const key of ["captures", "en_passant", "castles", "promotions"]) {
    if (needInt(result[key], key, 0, nodes) > nodes) throw new ValidationError(`${key} cannot exceed nodes`);
  }
  if ((result.en_passant as number) > (result.captures as number))
    throw new ValidationError("en_passant cannot exceed captures");
  return result;
}

export function requireString(value: unknown, what: string, pattern: RegExp, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !pattern.test(value))
    throw new ValidationError(`${what} is invalid`);
  return value;
}

export const WORKER_ID = /^[A-Za-z0-9_.:-]{8,64}$/;
export const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const PROBLEM = /^[a-z_]{3,32}$/;
export const RUN_ID = /^[0-9a-f]{8,64}$/;

export function optionalInt(value: unknown, what: string, min: number, max: number): number {
  return value === undefined ? min : needInt(value, what, min, max);
}

export { needInt };
