import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "./migrate";

export class DatabaseNotConfigured extends Error {
  constructor() {
    super("No database is configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }
}

let client: Client | undefined;
let ready: Promise<Client> | undefined;

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TURSO_DATABASE_URL) || env.NODE_ENV !== "production";
}

export function createDb(env: NodeJS.ProcessEnv = process.env): Client {
  const url = env.TURSO_DATABASE_URL || (env.NODE_ENV !== "production" ? "file:./.data/forge-dev.db" : "");
  if (!url) throw new DatabaseNotConfigured();
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    if (path && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  }
  const client = createClient({ url, authToken: env.TURSO_AUTH_TOKEN || undefined });
  // WAL persists in the file and lets local development handle concurrent writers; remote databases ignore this.
  if (url.startsWith("file:")) void client.execute("PRAGMA journal_mode=WAL").catch(() => undefined);
  return client;
}

/** Shared, migrated client. Migrations are idempotent, so every cold start can safely run them. */
export function getDb(): Promise<Client> {
  if (!ready) {
    client = createDb();
    ready = migrate(client)
      .then(() => client as Client)
      .catch((error) => {
        ready = undefined;
        client = undefined;
        throw error;
      });
  }
  return ready;
}
