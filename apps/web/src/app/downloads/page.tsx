import type { Metadata } from "next";
import { context } from "@/lib/context";
import { isDatabaseConfigured } from "@/lib/db";
import { listSnapshots } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Downloads" };
export const dynamic = "force-dynamic";

export default async function Downloads() {
  let snapshots: Awaited<ReturnType<typeof listSnapshots>> = [];
  if (isDatabaseConfigured()) {
    try {
      snapshots = await listSnapshots((await context()).db);
    } catch {
      snapshots = [];
    }
  }
  return (
    <>
      <h1>Downloads</h1>
      <p className="lede">
        Verified snapshots are immutable. Each one lists the hash of every file, so you can check what you
        downloaded.
      </p>
      <h2>Verified snapshots</h2>
      {snapshots.length === 0 ? (
        <div className="notice">
          No snapshot has been published yet. A snapshot is created by an administrator and contains only
          verified results.
        </div>
      ) : (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Snapshot</th>
                <th>Created</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.snapshot_id}>
                  <td className="mono">{s.snapshot_id}</td>
                  <td className="num">{new Date(s.created_at).toISOString().slice(0, 10)}</td>
                  <td>
                    {["manifest.json", "SHA256SUMS", "statistics.json", "verified-results.json"].map((f) => (
                      <a
                        key={f}
                        href={`/api/v1/snapshots/${s.snapshot_id}/${f}`}
                        style={{ marginRight: "1rem" }}
                      >
                        {f}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        Check a download with <code>sha256sum -c SHA256SUMS</code>. The manifest records the schema version,
        project commit, solver versions, verified job counts and aggregate results.
      </p>
      <h2>Reproduce a result yourself</h2>
      <pre>{`git clone https://github.com/Lord1Egypt/combinatorial-forge
cd combinatorial-forge
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j
./build/forge run nqueens --n 12 --workers 4 --db forge.sqlite
./build/forge verify --db forge.sqlite
./build/forge serve --db forge.sqlite      # local explorer on 127.0.0.1`}</pre>
      <h2>Your own database</h2>
      <p>
        <code>forge export --output snapshot.json.zst</code> writes a portable snapshot,{" "}
        <code>forge import</code> adds one to another database, and{" "}
        <code>forge merge a.sqlite b.sqlite merged.sqlite</code> combines two databases. Conflicting verified
        results are refused unless you choose which side wins.
      </p>
    </>
  );
}
