import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { allMigrations, migrate, schemaVersion, splitStatements } from "@/lib/migrate";
import { freshEnv } from "./helpers";

const root = path.join(__dirname, "..", "..", "..");

describe("migrations", () => {
  it("embedded migrations equal the canonical SQL files (no drift)", () => {
    const dir = path.join(root, "database", "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(allMigrations.map((m) => m.name)).toEqual(files.map((f) => f.replace(/\.sql$/, "")));
    files.forEach((f, i) => expect(allMigrations[i].sql).toBe(readFileSync(path.join(dir, f), "utf8")));
  });

  it("builds a complete schema on an empty database and is idempotent", async () => {
    const env = await freshEnv();
    try {
      expect(await schemaVersion(env.db)).toBe(allMigrations.length);
      expect(await migrate(env.db)).toBe(0);
      const tables = (await env.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map(
        (r) => String(r.name),
      );
      for (const t of [
        "problems",
        "solver_versions",
        "runs",
        "jobs",
        "job_leases",
        "submissions",
        "verifications",
        "aggregate_results",
        "snapshots",
        "schema_migrations",
        "chess_positions",
        "chess_edges",
        "chess_layers",
      ])
        expect(tables).toContain(t);
      const seeded = await env.db.execute("SELECT problem, required_matches FROM problems ORDER BY problem");
      expect(seeded.rows.map((r) => String(r.problem))).toEqual([
        "chess",
        "eight_puzzle",
        "lights_out",
        "nqueens",
        "tictactoe",
      ]);
    } finally {
      env.cleanup();
    }
  });

  it("detects a migration modified after it was applied", async () => {
    const env = await freshEnv();
    try {
      await env.db.execute("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
      await expect(migrate(env.db)).rejects.toThrow(/modified after being applied/);
    } finally {
      env.cleanup();
    }
  });

  it("resumes a partially migrated database", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "forge-mig-"));
    const db = createClient({ url: `file:${path.join(dir, "p.db")}` });
    try {
      expect(await migrate(db, allMigrations.slice(0, 1))).toBe(1);
      expect(await migrate(db)).toBe(allMigrations.length - 1);
      expect(await schemaVersion(db)).toBe(allMigrations.length);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("splits statements without touching comments", () => {
    expect(splitStatements("-- hi; there\nCREATE TABLE a (x INTEGER);\n\nCREATE INDEX i ON a (x);")).toEqual([
      "CREATE TABLE a (x INTEGER)",
      "CREATE INDEX i ON a (x)",
    ]);
  });

  it.skipIf(!existsSync(path.join(root, "build", "forge")))(
    "has the same schema as the native CLI (shared logical schema)",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "forge-parity-"));
      const nativePath = path.join(dir, "native.sqlite");
      execFileSync(path.join(root, "build", "forge"), ["init", "--db", nativePath]);
      const native = createClient({ url: `file:${nativePath}` });
      const env = await freshEnv();
      try {
        const shape = async (db: typeof native) => {
          const objects = await db.execute(
            "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type, name",
          );
          const result: Record<string, string[]> = {};
          for (const o of objects.rows) {
            if (String(o.type) !== "table") continue;
            const cols = await db.execute(
              `SELECT name, type, "notnull", pk FROM pragma_table_info('${String(o.name)}') ORDER BY cid`,
            );
            result[String(o.name)] = cols.rows.map(
              (c) => `${String(c.name)}:${String(c.type)}:${String(c.notnull)}:${String(c.pk)}`,
            );
          }
          return {
            tables: result,
            indexes: objects.rows.filter((o) => String(o.type) === "index").map((o) => String(o.name)),
          };
        };
        expect(await shape(env.db)).toEqual(await shape(native));
      } finally {
        native.close();
        env.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
