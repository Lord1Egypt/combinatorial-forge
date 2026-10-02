export interface Capabilities {
  supported: boolean;
  missing: string[];
  logicalCpus: number;
  mobile: boolean;
  maxWorkers: number;
  defaultWorkers: number;
  defaultIntensity: number;
}

export interface CapabilitySource {
  hardwareConcurrency?: number;
  userAgent?: string;
  userAgentDataMobile?: boolean;
  coarsePointer?: boolean;
  hasWorker: boolean;
  hasWasm: boolean;
  hasIndexedDb: boolean;
}

/** Pure decision logic so it can be tested without a browser. Mobile devices get conservative limits. */
export function evaluateCapabilities(source: CapabilitySource): Capabilities {
  const missing: string[] = [];
  if (!source.hasWorker) missing.push("Web Workers");
  if (!source.hasWasm) missing.push("WebAssembly");
  if (!source.hasIndexedDb) missing.push("IndexedDB");
  const cpus = Math.max(1, Math.min(64, Math.floor(source.hardwareConcurrency ?? 2)));
  const mobile =
    Boolean(source.userAgentDataMobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(source.userAgent ?? "")) ||
    Boolean(source.coarsePointer && cpus <= 8 && /Mobile|Android/i.test(source.userAgent ?? ""));
  const maxWorkers = mobile ? Math.min(2, cpus) : Math.max(1, cpus - 1);
  return {
    supported: missing.length === 0,
    missing,
    logicalCpus: cpus,
    mobile,
    maxWorkers,
    defaultWorkers: mobile ? 1 : Math.max(1, Math.floor(cpus / 4)),
    defaultIntensity: mobile ? 0.25 : 0.5,
  };
}

export function detectCapabilities(): Capabilities {
  const nav =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { userAgentData?: { mobile?: boolean } });
  return evaluateCapabilities({
    hardwareConcurrency: nav?.hardwareConcurrency,
    userAgent: nav?.userAgent,
    userAgentDataMobile: nav?.userAgentData?.mobile,
    coarsePointer: typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false,
    hasWorker: typeof Worker !== "undefined",
    hasWasm: typeof WebAssembly !== "undefined",
    hasIndexedDb: typeof indexedDB !== "undefined",
  });
}

export const INTENSITY_PRESETS = [
  { id: "light", label: "Light", intensity: 0.25 },
  { id: "balanced", label: "Balanced", intensity: 0.5 },
  { id: "high", label: "High", intensity: 0.9 },
] as const;

/** Maps an intensity (duty cycle 0.1-1) onto the worker count the user chose: workers run for that fraction of the time. */
export function dutyCycle(intensity: number): number {
  return Math.min(1, Math.max(0.1, intensity));
}
