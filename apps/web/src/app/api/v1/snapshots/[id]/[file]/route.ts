import { NextResponse } from "next/server";
import { context } from "@/lib/context";
import { ApiError, route } from "@/lib/http";

export const dynamic = "force-dynamic";
const FILES = new Set(["manifest.json", "SHA256SUMS", "statistics.json", "verified-results.json"]);

/** Snapshots are immutable and content-addressed, so they are served with long-lived caching. */
export const GET = route(
  async (_request: Request, { params }: { params: Promise<{ id: string; file: string }> }) => {
    const { id, file } = await params;
    if (!/^\d{8}-[0-9a-f]{10}$/.test(id) || !FILES.has(file))
      throw new ApiError(404, "not_found", "no such snapshot file");
    const r = await (
      await context()
    ).db.execute({
      sql: "SELECT content, sha256 FROM snapshot_files WHERE snapshot_id = ? AND name = ?",
      args: [id, file],
    });
    if (r.rows.length === 0) throw new ApiError(404, "not_found", "no such snapshot file");
    return new NextResponse(String(r.rows[0].content), {
      headers: {
        "Content-Type":
          file === "SHA256SUMS" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: `"${String(r.rows[0].sha256)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
