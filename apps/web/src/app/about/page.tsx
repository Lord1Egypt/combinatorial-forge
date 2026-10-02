import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function About() {
  return (
    <>
      <h1>About</h1>
      <p className="lede">
        Combinatorial Forge started as four exact solvers and is growing into a place to run, check and share
        exhaustive computations.
      </p>
      <h2>What it is</h2>
      <p>
        One C++ engine does the counting. It runs natively with a resumable local database, in the browser as
        WebAssembly, and on a server for verification. Because it is one engine, a result computed anywhere
        can be reproduced anywhere.
      </p>
      <h2>What it is not</h2>
      <p>
        It does not claim to have solved chess. It does not mine cryptocurrency. It does not run anything in
        your browser until you ask it to.
      </p>
      <h2>Your data</h2>
      <p>
        The site stores no accounts. A contributing browser holds a random worker identifier on its own
        device. The server keeps a salted one-way hash of the network address to stop one network from
        verifying its own results, and never stores the address itself.
      </p>
      <h2>Source and licence</h2>
      <p>
        The code is open source under the MIT licence at{" "}
        <a href="https://github.com/Lord1Egypt/combinatorial-forge">
          github.com/Lord1Egypt/combinatorial-forge
        </a>
        . You can deploy your own instance with your own database; see the deployment guide in the repository.
      </p>
    </>
  );
}
