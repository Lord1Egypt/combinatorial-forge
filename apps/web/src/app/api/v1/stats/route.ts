import { context } from "@/lib/context";
import { cached, route } from "@/lib/http";
import { jobStats } from "@/lib/jobs";
import { chessLayers } from "@/lib/explorer";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await context();
  return cached(
    { generated_at: Date.now(), ...(await jobStats(ctx.db)), chess_layers: await chessLayers(ctx.db) },
    15,
  );
});
