import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Canonical JSON used for job identifiers and result hashes: keys sorted bytewise, no whitespace,
 * integers only. It is byte-identical to the C++ engine's `Json::dump()` (see database/fixtures).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new TypeError("canonical JSON allows safe integers only");
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
    }
    default:
      throw new TypeError(`cannot canonicalize ${typeof value}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const jobIdOf = (definition: unknown): string => sha256Hex(canonicalJson(definition));
export const resultHashOf = (result: unknown): string => sha256Hex(canonicalJson(result));
