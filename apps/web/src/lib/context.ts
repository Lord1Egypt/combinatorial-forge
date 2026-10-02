import { loadConfig } from "./config";
import { getDb } from "./db";
import type { Ctx } from "./jobs";

export async function context(): Promise<Ctx> {
  return { db: await getDb(), now: Date.now, requireDistinctNetworks: loadConfig().requireDistinctNetworks };
}
