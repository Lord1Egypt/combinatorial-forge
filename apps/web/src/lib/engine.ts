import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

interface EmscriptenModule {
  ccall(name: string, returnType: "string", argTypes: ["string"], args: [string]): string;
}

let loading: Promise<EmscriptenModule> | undefined;

/** Loads the same WebAssembly build the browser runs, so the server and workers share one engine. */
function load(): Promise<EmscriptenModule> {
  if (!loading) {
    const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "wasm");
    const nodeRequire = createRequire(path.join(dir, "loader.cjs"));
    const create = nodeRequire(path.join(dir, "forge.js")) as (options: object) => Promise<EmscriptenModule>;
    loading = create({ wasmBinary: readFileSync(path.join(dir, "forge.wasm")) });
  }
  return loading;
}

export async function engineCall<T = unknown>(method: string, params: object = {}): Promise<T> {
  const wasm = await load();
  const reply = JSON.parse(
    wasm.ccall("forge_call", "string", ["string"], [JSON.stringify({ method, params })]),
  ) as { ok: true; result: T } | { ok: false; error: string };
  if (!reply.ok) throw new Error(`engine: ${reply.error}`);
  return reply.result;
}
