import type { Metadata } from "next";
import Link from "next/link";
import { Status } from "@/components/Board";
import { PROBLEMS } from "@/lib/problems";

export const metadata: Metadata = { title: "Explorer" };

export default function ExplorerIndex() {
  return (
    <>
      <h1>Explorer</h1>
      <p className="lede">
        Step through each problem state by state. Everything here is computed by the same engine that produced
        the verified results.
      </p>
      <ul className="toc">
        {PROBLEMS.map((p) => (
          <li key={p.id}>
            <Link className="row" href={`/explorer/${p.id}`}>
              <span className="name">{p.title}</span>
              <span className="what">{p.headline}</span>
              <Status status={p.status} />
            </Link>
          </li>
        ))}
        <li>
          <Link className="row" href="/explorer/jobs">
            <span className="name">Job database</span>
            <span className="what">
              Browse distributed work units by problem, run, status and depth, and export them as JSON.
            </span>
            <span />
          </Link>
        </li>
      </ul>
    </>
  );
}
