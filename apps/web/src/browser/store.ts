export interface StoredClaim {
  job_id: string;
  base_url: string;
  worker_id: string;
  lease_token: string;
  lease_until: number;
  payload: Record<string, unknown>;
  state: Record<string, unknown> | null;
  nodes: number;
  progress_permille: number;
  /** Set once the computation finished but the upload has not been acknowledged yet. */
  pending_result: { result: Record<string, unknown>; nodes: number; runtime_ms: number } | null;
  updated_at: number;
}

const DB_NAME = "forge-compute";
const VERSION = 1;

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** IndexedDB persistence for claimed work, checkpoints and not-yet-uploaded results. */
export class ClaimStore {
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB): Promise<ClaimStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("claims")) db.createObjectStore("claims", { keyPath: "job_id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(new ClaimStore(request.result));
      request.onerror = () => reject(request.error ?? new Error("cannot open IndexedDB"));
    });
  }

  private store(name: "claims" | "meta", mode: IDBTransactionMode) {
    return this.db.transaction(name, mode).objectStore(name);
  }

  async saveClaim(claim: StoredClaim): Promise<void> {
    await wrap(this.store("claims", "readwrite").put(claim));
  }

  async deleteClaim(jobId: string): Promise<void> {
    await wrap(this.store("claims", "readwrite").delete(jobId));
  }

  async listClaims(baseUrl?: string): Promise<StoredClaim[]> {
    const all = (await wrap(this.store("claims", "readonly").getAll())) as StoredClaim[];
    return all
      .filter((c) => !baseUrl || c.base_url === baseUrl)
      .sort((a, b) => a.job_id.localeCompare(b.job_id));
  }

  async clearClaims(): Promise<void> {
    await wrap(this.store("claims", "readwrite").clear());
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await wrap(this.store("meta", "readonly").get(key))) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await wrap(this.store("meta", "readwrite").put(value, key));
  }

  close(): void {
    this.db.close();
  }
}

/** Aggregate completion of unfinished claims, e.g. 684 for "68.4% complete". */
export function overallProgressPermille(claims: StoredClaim[]): number {
  if (claims.length === 0) return 0;
  return Math.round(
    claims.reduce((sum, c) => sum + (c.pending_result ? 1000 : c.progress_permille), 0) / claims.length,
  );
}

export function formatPermille(permille: number): string {
  return `${(permille / 10).toFixed(1)}%`;
}
