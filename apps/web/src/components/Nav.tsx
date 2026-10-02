"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  ["/problems", "Problems"],
  ["/explorer", "Explorer"],
  ["/compute", "Compute"],
  ["/statistics", "Statistics"],
  ["/verification", "Verification"],
  ["/methodology", "Methodology"],
  ["/downloads", "Downloads"],
  ["/about", "About"],
] as const;

export function Nav() {
  const path = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("forge-theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only initialisation after hydration
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      /* storage unavailable: follow the system setting */
    }
  }, []);
  function toggle() {
    const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const next = (theme ?? system) === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("forge-theme", next);
    } catch {
      /* ignore */
    }
  }
  return (
    <nav className="main" aria-label="Main">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href || path.startsWith(href + "/") ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
      <button type="button" className="theme" onClick={toggle} aria-label="Toggle light and dark theme">
        Theme
      </button>
    </nav>
  );
}
