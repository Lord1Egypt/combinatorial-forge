import { requireAdmin } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import { context } from "@/lib/context";
import { json, readJson, route } from "@/lib/http";
import { schemaVersion } from "@/lib/migrate";
import { buildSnapshot, storeSnapshot } from "@/lib/snapshot";
import { requireString } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (request: Request) => {
  requireAdmin(request);
  const body = await readJson(request, 2 * 1024);
  const ctx = await context();
  const projectCommit = requireString(
    body.project_commit ?? "unknown",
    "project_commit",
    /^[0-9a-f]{7,40}$|^unknown$/,
  );
  const schema = await schemaVersion(ctx.db);
  const now = ctx.now();
  const built = await buildSnapshot(ctx.db, {
    projectCommit,
    siteUrl: loadConfig().siteUrl,
    now,
    schemaVersion: schema,
  });
  await storeSnapshot(ctx.db, built, { projectCommit, schemaVersion: schema, now });
  return json(
    {
      snapshot_id: built.snapshotId,
      manifest: built.manifest,
      download: `/api/v1/snapshots/${built.snapshotId}/`,
    },
    201,
  );
});
