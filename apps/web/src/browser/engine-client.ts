export interface EngineHandle {
  call<T = unknown>(method: string, params?: object): Promise<T>;
  terminate(): void;
}

/** Spawns the engine worker (public/wasm/engine-worker.js). Each handle is an independent WebAssembly instance. */
export function spawnEngineWorker(url = "/wasm/engine-worker.js"): EngineHandle {
  const worker = new Worker(url);
  let next = 1;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.result as never);
    else entry.reject(new Error(event.data.error ?? "engine error"));
  };
  worker.onerror = (event) => {
    for (const [, entry] of pending) entry.reject(new Error(event.message || "worker failed"));
    pending.clear();
  };
  return {
    call<T>(method: string, params: object = {}) {
      return new Promise<T>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve: resolve as (v: never) => void, reject });
        worker.postMessage({ id, method, params });
      });
    },
    terminate() {
      worker.terminate();
      for (const [, entry] of pending) entry.reject(new Error("worker terminated"));
      pending.clear();
    },
  };
}

let shared: EngineHandle | undefined;
/** A lazily created engine for the interactive explorers. */
export function sharedEngine(): EngineHandle {
  return (shared ??= spawnEngineWorker());
}
