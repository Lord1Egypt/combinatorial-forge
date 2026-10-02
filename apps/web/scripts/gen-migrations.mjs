// Embeds ../../database/migrations/*.sql into src/generated/migrations.json so the web build
// never depends on files outside this directory. The canonical SQL stays in database/migrations.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "database", "migrations");
const target = join(here, "..", "src", "generated", "migrations.json");

if (!existsSync(source)) {
  if (existsSync(target)) {
    console.log("migrations: canonical directory not present; keeping committed copy");
    process.exit(0);
  }
  throw new Error("database/migrations not found and no committed copy exists");
}
const migrations = readdirSync(source)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => {
    const sql = readFileSync(join(source, name), "utf8");
    return {
      version: Number.parseInt(name.slice(0, name.indexOf("_")), 10),
      name: name.replace(/\.sql$/, ""),
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    };
  });
mkdirSync(dirname(target), { recursive: true });
const next = JSON.stringify(migrations, null, 2) + "\n";
if (!existsSync(target) || readFileSync(target, "utf8") !== next) writeFileSync(target, next);
console.log(`migrations: ${migrations.length} embedded`);
