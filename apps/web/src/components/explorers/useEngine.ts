"use client";

import { useCallback, useState } from "react";
import { sharedEngine } from "@/browser/engine-client";

/** Calls the shared WebAssembly engine; reports failures as text instead of throwing into React. */
export function useEngine() {
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(async <T>(method: string, params: object = {}): Promise<T | null> => {
    try {
      setError(null);
      return await sharedEngine().call<T>(method, params);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The engine could not run.");
      return null;
    }
  }, []);
  return { call, error };
}
