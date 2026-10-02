import type { Client, InStatement } from "@libsql/client";
import migrations from "@/generated/migrations.json";

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

/** Splits a migration script into statements. Migrations must not contain ';' inside literals or comments. */
export function splitStatements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const allMigrations = migrations as Migration[];

/** Applies pending migrations in order inside one transaction each; verifies checksums of applied ones. */
export async function migrate(
  db: Client,
  list: Migration[] = allMigrations,
  now = Date.now(),
): Promise<number> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  let applied = 0;
  for (const m of list) {
    const found = await db.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE version = ?",
      args: [m.version],
    });
    if (found.rows.length > 0) {
      if (found.rows[0].checksum !== m.checksum)
        throw new Error(`migration ${m.name} was modified after being applied`);
      continue;
    }
    const statements: InStatement[] = splitStatements(m.sql);
    statements.push({
      sql: "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      args: [m.version, m.name, m.checksum, now],
    });
    try {
      await db.batch(statements, "write");
      applied++;
    } catch (error) {
      // Another instance may have applied it between our check and our write.
      const again = await db.execute({
        sql: "SELECT 1 FROM schema_migrations WHERE version = ?",
        args: [m.version],
      });
      if (again.rows.length === 0) throw error;
    }
  }
  return applied;
}

export async function schemaVersion(db: Client): Promise<number> {
  const result = await db.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations");
  return Number(result.rows[0].v);
}
