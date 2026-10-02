import { requireAdmin } from "@/lib/auth";
import { importChess } from "@/lib/chess-import";
import { context } from "@/lib/context";
import { json, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Chunked import of chess research rows (positions, edges, layers) from a native snapshot. */
export const POST = route(async (request: Request) => {
  requireAdmin(request);
  const body = await readJson(request, 3 * 1024 * 1024);
  return json(await importChess((await context()).db, body));
});
