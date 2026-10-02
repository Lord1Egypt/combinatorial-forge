const GLYPH: Record<string, string> = {
  p: "♟",
  n: "♞",
  b: "♝",
  r: "♜",
  q: "♛",
  k: "♚",
  P: "♙",
  N: "♘",
  B: "♗",
  R: "♖",
  Q: "♕",
  K: "♔",
};

/** Renders an EPD/FEN placement as a board. Presentation only; the position comes from the engine. */
export function ChessBoard({ epd, label }: { epd: string; label?: string }) {
  const rows = epd.split(" ")[0].split("/");
  const squares: { glyph: string; light: boolean; key: string }[] = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        for (let k = 0; k < Number(ch); k++, f++)
          squares.push({ glyph: "", light: (r + f) % 2 === 0, key: `${r}-${f}` });
      } else {
        squares.push({ glyph: (GLYPH[ch] ?? "?") + "\uFE0E", light: (r + f) % 2 === 0, key: `${r}-${f}` });
        f++;
      }
    }
  });
  return (
    <div className="board chess" role="img" aria-label={label ?? `Chess position ${epd}`}>
      {squares.map((s) => (
        <div key={s.key} className={`sq ${s.light ? "l" : "d"}`}>
          {s.glyph ? <span>{s.glyph}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** An N-Queens placement: columns[i] is the queen's column in row i. */
export function QueensBoard({ n, columns, label }: { n: number; columns: number[]; label?: string }) {
  const cells = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      cells.push(
        <div key={`${r}-${c}`} className={`sq ${(r + c) % 2 === 0 ? "l" : "d"}`}>
          {columns[r] === c ? <span>♛{"\uFE0E"}</span> : null}
        </div>,
      );
  return (
    <div
      className="board"
      style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      role="img"
      aria-label={label ?? `${n} queens placement: ${columns.join(", ")}`}
    >
      {cells}
    </div>
  );
}

export function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={label}>
      <div className="bars">
        {values.map((v, i) => (
          <div
            key={i}
            title={`${i}: ${v.toLocaleString("en-US")}`}
            style={{ height: `${Math.max(1, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="bars-axis">
        <span>0 moves</span>
        <span>{values.length - 1} moves</span>
      </div>
    </div>
  );
}

export function Status({ status }: { status: "complete" | "partial" | "research" }) {
  const text = status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Research computation";
  return (
    <span className={`tag ${status === "complete" ? "" : status === "partial" ? "warn" : "research"}`}>
      {text}
    </span>
  );
}
