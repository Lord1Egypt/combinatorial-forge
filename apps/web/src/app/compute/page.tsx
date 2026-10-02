import type { Metadata } from "next";
import { ComputePanel } from "@/components/ComputePanel";

export const metadata: Metadata = { title: "Compute" };

export default function ComputePage() {
  return (
    <>
      <h1>Contribute computing power</h1>
      <p className="lede">
        Lend this browser to an exhaustive search. You decide when it starts, how hard it works, and when it
        stops.
      </p>
      <ComputePanel />
    </>
  );
}
