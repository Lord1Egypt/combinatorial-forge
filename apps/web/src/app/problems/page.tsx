import type { Metadata } from "next";
import Link from "next/link";
import { Status } from "@/components/Board";
import { PROBLEMS } from "@/lib/problems";

export const metadata: Metadata = { title: "Problems" };

export default function Problems() {
  return (
    <>
      <h1>Problems</h1>
      <p className="lede">
        Four problems are completely solved and independently checked. Chess is an open computation, and the
        site says so everywhere it appears.
      </p>
      <ul className="toc">
        {PROBLEMS.map((p) => (
          <li key={p.id}>
            <Link className="row" href={`/problems/${p.id}`}>
              <span className="name">{p.title}</span>
              <span className="what">
                <strong>{p.headline}.</strong> {p.summary}
              </span>
              <Status status={p.status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
