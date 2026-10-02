import { context } from "@/lib/context";
import { ApiError, cached, route } from "@/lib/http";
import { problemById } from "@/lib/problems";
import { canonicalResult } from "@/lib/results";
import { chessLayers } from "@/lib/explorer";

export const dynamic = "force-dynamic";

export const GET = route(async (_request: Request, { params }: { params: Promise<{ problem: string }> }) => {
  const { problem } = await params;
  const info = problemById(problem);
  if (!info) throw new ApiError(404, "unknown_problem", "unknown problem");
  if (problem === "chess") {
    const ctx = await context();
    return cached(
      {
        problem,
        status: info.status,
        solved: false,
        layers: await chessLayers(ctx.db),
        note: "Partial research results only. Chess is not solved.",
      },
      15,
    );
  }
  return cached(
    {
      problem,
      status: info.status,
      provenance: "results/*.json in the source repository",
      result: canonicalResult(problem),
    },
    300,
  );
});
