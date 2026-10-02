import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Combinatorial Forge", template: "%s · Combinatorial Forge" },
  description:
    "Resumable exact solvers, distributed verification, persistent search databases, and interactive visualization for combinatorial games and puzzles.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem("forge-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <header className="site">
          <div className="wrap">
            <Link className="brand" href="/">
              Combinatorial Forge
            </Link>
            <Nav />
          </div>
        </header>
        <main id="content">
          <div className="wrap">{children}</div>
        </main>
        <footer className="site">
          <div className="wrap">
            <span>Explore finite worlds, exhaustively.</span>
            <span>
              <a href="https://github.com/Lord1Egypt/combinatorial-forge">Source on GitHub</a>, MIT licence
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
