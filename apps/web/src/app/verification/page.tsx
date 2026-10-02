import type { Metadata } from "next";
import Link from "next/link";
import { context } from "@/lib/context";
import { isDatabaseConfigured } from "@/lib/db";
import { results } from "@/lib/results";

export const metadata: Metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

async function policies() {
  if (!isDatabaseConfigured()) return null;
  try {
    const r = await (
      await context()
    ).db.execute(
      "SELECT problem, required_matches, lease_seconds, max_attempts FROM problems ORDER BY problem",
    );
    return r.rows.map((x) => ({
      problem: String(x.problem),
      required: Number(x.required_matches),
      lease: Number(x.lease_seconds),
      attempts: Number(x.max_attempts),
    }));
  } catch {
    return null;
  }
}

export default async function Verification() {
  const policy = await policies();
  return (
    <>
      <h1>Verification</h1>
      <p className="lede">
        A result is not true because someone submitted it. It becomes verified only when independent computers
        reproduce it.
      </p>

      <h2>How a distributed result is verified</h2>
      <div className="cols">
        <div>
          <h3 style={{ marginTop: 0 }}>Submitted</h3>
          <p>
            One worker returned a result. It is stored, never published as verified, and the job goes back to
            the pool for a second worker.
          </p>
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>Verified</h3>
          <p>
            The required number of different workers, on different networks, returned byte-identical results
            (compared by SHA-256 of the canonical form).
          </p>
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>Disputed</h3>
          <p>
            Workers returned different results. Another independent computation, or a trusted recomputation by
            a native or server-side verifier, settles it.
          </p>
        </div>
      </div>
      <p>
        Verified results carry the solver version, platform and the submissions that agreed. A trusted
        verifier can recompute any job; if it disagrees with an already verified result, the job is reopened
        and the trusted value wins.
      </p>

      <h2>Policy per problem</h2>
      {policy ? (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Problem</th>
                <th className="r">Matching results required</th>
                <th className="r">Lease</th>
                <th className="r">Attempts before failing</th>
              </tr>
            </thead>
            <tbody>
              {policy.map((p) => (
                <tr key={p.problem}>
                  <td>{p.problem}</td>
                  <td className="r num">{p.required}</td>
                  <td className="r num">{p.lease / 60} min</td>
                  <td className="r num">{p.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice">
          No database is connected, so the live policy cannot be shown. The defaults are two matching results
          for distributed problems.
        </div>
      )}

      <h2>What redundancy does and does not prove</h2>
      <p>
        Agreement between independent workers protects against faulty hardware, interrupted computations and
        individual dishonest contributors. It does not protect against a bug in the solver itself, because
        every worker runs the same engine. Solver correctness is checked separately: the chess move generator
        reproduces the standard perft suites, N-Queens counts match two independent implementations, and the
        engine is tested against every baseline result below.
      </p>

      <h2>How the four complete problems were checked</h2>
      <div className="scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Problem</th>
              <th>Primary computation</th>
              <th>Independent check</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>N-Queens</td>
              <td>Recursive row-wise bitboard search</td>
              <td>
                Iterative transposed bitboard search; equal for every N from 1 to{" "}
                {results.nqueens.verified_through}
              </td>
            </tr>
            <tr>
              <td>Tic-Tac-Toe</td>
              <td>Search over every legal history</td>
              <td>Breadth-first search over distinct states</td>
            </tr>
            <tr>
              <td>8-Puzzle</td>
              <td>Breadth-first distances</td>
              <td>Every optimal path replayed move by move</td>
            </tr>
            <tr>
              <td>Lights Out 5×5</td>
              <td>Gray-code enumeration of all 2²⁵ press patterns</td>
              <td>Linear algebra over GF(2) for every board</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Solver provenance</h2>
      <p>
        These SHA-256 hashes identify the exact baseline solver sources behind the headline results (tag{" "}
        <code>v0.1.0</code>).
      </p>
      <div className="scroll">
        <table className="data">
          <tbody>
            {Object.entries(results.source_hashes).map(([file, hash]) => (
              <tr key={file}>
                <td className="mono">{file}</td>
                <td className="mono">{hash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <Link href="/explorer/jobs?status=disputed">Review disputed jobs</Link> or{" "}
        <Link href="/explorer/jobs?status=verified">browse verified jobs</Link>.
      </p>
    </>
  );
}
