import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ENGINE_VERSION } from "@/lib/jobs";
import { schemaVersion } from "@/lib/migrate";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  let database: "ok" | "unconfigured" | "error" = "unconfigured";
  let schema: number | null = null;
  if (isDatabaseConfigured()) {
    try {
      schema = await schemaVersion(await getDb());
      database = "ok";
    } catch {
      database = "error";
    }
  }
  return json(
    { service: "combinatorial-forge", api: "v1", engine: ENGINE_VERSION, database, schema_version: schema },
    database === "error" ? 503 : 200,
  );
});
