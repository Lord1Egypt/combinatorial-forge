#!/usr/bin/env bash
# Builds the engine to WebAssembly (needs Emscripten on PATH) and records provenance.
set -euo pipefail
command -v em++ >/dev/null || { echo 'Emscripten em++ is required' >&2; exit 127; }
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/apps/web/public/wasm"
mkdir -p "$out"
rm -f "$out/forge.js" "$out/forge.wasm"
em++ -std=c++17 -O3 -fwasm-exceptions -I"$root/engine" "$root/wasm/forge_wasm.cpp" -o "$out/forge.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createForge -sEXPORTED_FUNCTIONS=_forge_call -sEXPORTED_RUNTIME_METHODS=UTF8ToString,ccall \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB -sSTACK_SIZE=1MB -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 -sASSERTIONS=0
engine_hash=$(cat "$root"/engine/forge/*.hpp "$root/wasm/forge_wasm.cpp" | sha256sum | cut -d' ' -f1)
python3 - "$out" "$engine_hash" "$(em++ --version | head -1)" <<'PY'
import hashlib, json, sys
out, engine_hash, emcc = sys.argv[1:4]
def sha(path):
    return hashlib.sha256(open(f"{out}/{path}", "rb").read()).hexdigest()
info = {"emcc": emcc, "engine_sources_sha256": engine_hash, "forge.wasm": sha("forge.wasm"), "forge.js": sha("forge.js"),
        "flags": "-O3 -fwasm-exceptions -sMODULARIZE=1 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB"}
json.dump(info, open(f"{out}/build-info.json", "w"), indent=2, sort_keys=True)
open(f"{out}/build-info.json", "a").write("\n")
print(json.dumps(info, indent=2))
PY
