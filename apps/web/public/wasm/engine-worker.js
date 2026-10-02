// Classic Web Worker hosting the shared WebAssembly engine. One generic message: {id, method, params}.
let ready;
function load() {
  if (!ready) {
    importScripts("/wasm/forge.js");
    ready = self.createForge({ locateFile: (file) => "/wasm/" + file });
  }
  return ready;
}
self.onmessage = async (event) => {
  const { id, method, params } = event.data;
  try {
    const wasm = await load();
    const reply = JSON.parse(wasm.ccall("forge_call", "string", ["string"], [JSON.stringify({ method, params })]));
    self.postMessage(reply.ok ? { id, ok: true, result: reply.result } : { id, ok: false, error: reply.error });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
