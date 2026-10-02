import { getDb } from "@/lib/db";
import { explore } from "@/lib/explorer";
import { cached, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(
  async (request: Request, { params }: { params: Promise<{ problem: string; slug?: string[] }> }) => {
    const { problem, slug } = await params;
    return cached(await explore(getDb, problem, slug ?? [], new URL(request.url).searchParams), 30);
  },
);
