# Web deployment

The Next.js project root is `apps/web`. The one-click button in the README sets
this root and asks each deployer for their **own** database URL, database token,
and admin token. It contains no owner credentials or default secret values.

1. Create a SQLite-compatible remote libSQL database (for example Turso) in
   your own account. Obtain its `libsql://` URL and an authentication token.
2. Generate a separate admin token of at least 24 characters, for example with
   `openssl rand -base64 32`. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and
   `ADMIN_TOKEN` as server-side Vercel environment variables. Never prefix
   these names with `NEXT_PUBLIC_`.
3. Deploy from the public repository with root directory `apps/web`. The first
   database access applies the versioned SQL migrations and verifies existing
   migration checksums. `GET /api/v1/health` must report `database: ok` and
   `schema_version: 3` before accepting contributions.
4. Use the bearer `ADMIN_TOKEN` on `/api/v1/admin/runs` to create deterministic
   N-Queens or chess work. The API also exposes authenticated maintenance,
   verification, chess import, and snapshot creation. Do not put the admin
   token in browser code or a public URL.

Local development defaults to `file:./.data/forge-dev.db` when no database URL
is set. Production requires `TURSO_DATABASE_URL`; Vercel's ephemeral filesystem
is not a persistent database. See `apps/web/.env.example` for all variables.
`FORGE_REQUIRE_DISTINCT_NETWORKS` defaults to true in production. Public
results need independent matching submissions under the configured policy;
an administrator can perform a trusted server-side recomputation.

The site serves the checked-in WASM engine. After rebuilding it with
`scripts/build_wasm.sh`, commit `forge.js`, `forge.wasm`, and `build-info.json`
together. `npm run verify:wasm` checks their recorded hashes and exact native
response parity. The native `forge connect` and `forge contribute` commands can
use the deployed HTTPS API without receiving database credentials.

The deploy button provisions the application only. The deployer must create
their database and supply the three values; no private data repository is
required. The online database is mutable storage. Immutable verified snapshots
can be published from its snapshot API, while the native CLI supports JSON or
optional zstd export, import, and explicit conflict-resolving merge.
